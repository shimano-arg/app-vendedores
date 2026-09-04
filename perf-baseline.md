# perf-baseline.md

Baseline de performance para el flujo Pedido en Espera. Generado por
`scripts/bench-waitlist.mjs`.

**Regenerar**: `node scripts/bench-waitlist.mjs`

## Última corrida

- **Fecha (UTC)**: 2026-09-04T19:48:01.618Z
- **Commit**: `local`
- **Runs**: 5 (median calculado sobre estos)
- **Iteraciones por run**: 1000
- **Fixture**: 500 pedidos-app, 200 SKUs, 30 clientes
- **Total bench time**: 2166 ms (gate <10.000 ms)

## Resultados

| Función | n_runs | median (ms) | p95 (ms) | max (ms) | µs por iter |
|---|---|---|---|---|---|
| getStockPorCliente (diverse sku,cc) | 5 | 148.5405 | 168.7149 | 168.7149 | 150.57 |
| getStockPorCliente (repeat same sku,cc) | 5 | 141.721 | 155.2619 | 155.2619 | 144.04 |
| getStockPorClienteMemo (repeat + cache) | 5 | 0.4613 | 1.1638 | 1.1638 | 0.64 |
| getStockRealmenteDisponible (diverse sku) | 5 | 135.0494 | 144.9518 | 144.9518 | 136.18 |

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
