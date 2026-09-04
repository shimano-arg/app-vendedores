# perf-baseline.md

Baseline de performance para el flujo Pedido en Espera. Generado por
`scripts/bench-waitlist.mjs`.

**Regenerar**: `node scripts/bench-waitlist.mjs`

## Última corrida

- **Fecha (UTC)**: 2026-09-04T18:53:56.018Z
- **Commit**: `local`
- **Runs**: 5 (median calculado sobre estos)
- **Iteraciones por run**: 1000
- **Fixture**: 500 pedidos-app, 200 SKUs, 30 clientes
- **Total bench time**: 2128 ms (gate <10.000 ms)

## Resultados

| Función | n_runs | median (ms) | p95 (ms) | max (ms) | µs por iter |
|---|---|---|---|---|---|
| getStockPorCliente (diverse sku,cc) | 5 | 141.7324 | 165.1821 | 165.1821 | 146.83 |
| getStockPorCliente (repeat same sku,cc) | 5 | 142.5263 | 145.8615 | 145.8615 | 142.58 |
| getStockRealmenteDisponible (diverse sku) | 5 | 131.2748 | 139.672 | 139.672 | 132.75 |

## Interpretación

- **median (ms)**: tiempo mediano por RUN. Cada run hace 1000 calls
  a la función.
- **µs por iter**: costo promedio de UNA sola llamada, útil para dimensionar
  overhead de memoization (iter 6).

## Escenarios

- **diverse sku,cc**: cada iteración usa (sku, cardCode) distintos.
  Peor caso realista: vendedor viendo su cliente + navegando entre SKUs.
- **repeat same sku,cc**: misma (sku, cardCode) N veces. Es el que
  iter 6 memoization va a atacar. Meta post-memoization: ≥60% reducción
  del median.
- **getStockRealmenteDisponible**: fn base, sin discriminación por cliente.
  Referencia de costo mínimo.

## TODO — fuera de scope de iter 1

- Bench de `_renderWaitlistCard` (index.html:16129, ~1.664 líneas).
  Requiere jsdom. Estimado 2h.
- Bench de `_renderClienteAllOpenLines` (index.html:15196+).
  Requiere jsdom.
- Bench del initial paint del modal completo (Lighthouse mobile 4G).

## Historial

_Bumpear versión al pie después de cada corrida documentada oficial_

- v803 (2026-09-04): baseline inicial. Ver tabla arriba.
