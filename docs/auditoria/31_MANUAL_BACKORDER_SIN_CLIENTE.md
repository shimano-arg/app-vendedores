# L — Pedidos manual-backorder sin cliente @ 2026-10-22T19:46:45.313Z

Pedidos con `source=manual-backorder` o `transferidoSAP.via=manual-backorder` que tienen `clientName` vacío o `key` malformado. En la UI aparecen como "undefined - BACKORDER / cliente undefined".

## Totales

- Total afectados: **0**
- Backfilleable (hay clientCardCode + match en client_master): **0**
- Identificación manual: **0**

## Dry-run propuesto (0 pedidos)

| Pedido ID | Orden | Confirmado | CardCode | → ClientName | → Key |
|---|---|---|---|---|---|

## Identificación manual (0 pedidos)

| Pedido ID | Orden | Confirmado | $ARS | CardCode | SKUs | SKU muestra |
|---|---|---|---:|---|---:|---|

## Siguiente paso

Mariano decide: aplicar backfill de los 0 pedidos backfilleables (correr este script con `--apply`) o resolver uno a uno.

Script: `scripts/audit/L_manual_backorder_sin_cliente.cjs`. NO escribe en prod — dry-run only.
