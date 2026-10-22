# J — Sobre-asignadas en prod @ 2026-10-22T19:46:48.578Z

Lista read-only de líneas `state=ASIG` con `sobreAsignada > 0` según `getStockBreakdown` v1395 §40.3.

Scope: SKUs con físico dep 11 > 0 ∪ SKUs con alguna línea ASIG en pedidos abiertos.

## Totales

- SKUs con sobre-asignadas: **0**
- Líneas sobre-asignadas: **0**
- Unidades sobre-asignadas: **0**

## Tabla (top 100 por sobre-asignada)

| SKU | Cliente | CardCode | Prometidas | Entregables | Sobre | asigAt | pedidoId |
|---|---|---|---:|---:|---:|---|---|

## Nota

El flag `sobreAsignada` es **computed** (CLAUDE.md §39/§40.3): no persiste en Firestore.
Si entra stock que cubre el nominal, desaparece solo al próximo read del breakdown.

Script generador: `scripts/audit/J_sobre_asignadas_prod.cjs`.
