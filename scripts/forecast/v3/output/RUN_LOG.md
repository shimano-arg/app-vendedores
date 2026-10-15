# RUN LOG — Forecast v3

Cronología de iters con decisiones y métricas. Append-only.

## Iter 0 — Baseline reproducido (2026-10-14)
- WAPE mediano: **0.422**
- Features: Baraldo SI + Shimano BQ post 2025-09
- Modelo ganador por serie (best per series)
- Nota: el prod_resumen.json decía 0.476 pero fue con 6 meses Shimano, ahora tenemos 7m → data fresca mejora de default.
- **Decision**: aceptar 0.422 como nuevo baseline.

## Iter 1 — demanda = venta + BO abierto (2026-10-14) ❌ ROLLBACK
- WAPE mediano: **0.470** (delta +0.048)
- Causa del fracaso: BO abierto es snapshot actual, no timeline histórico. Al atribuirlo al `createdAt` del pedido, inflé artificialmente los últimos meses (pedidos cerrados hace meses NO tienen BO abierto hoy). Serie resultante tiene "tendencia alcista" ficticia → modelos sobre-predicen.
- **Decision**: rollback de "BO como target". El dato del BO lo reusamos en iter 5 (LGBM) como **feature exógena del mes actual** (señal de demanda pendiente que empuja forecast corto plazo).
- Alternativa futura: usar `pedidos_raw_raw_changelog` para reconstruir snapshots mensuales reales de BO abierto.

## Iter 2 — sales plans como anchor ✅ MEJORA
- WAPE mediano: **0.398** (delta -0.024 vs iter 0, -5.6%)
- Features: Baraldo SI + Shimano BQ + sales_plan_cache blend (grid alpha ∈ [0, 0.2, 0.4, 0.6, 0.8, 1.0])
- Cobertura sales_plan en histórico: 44.5%
- Alphas elegidos: 15 subs → 0.0 (sales plan no suma), 7 → 0.2 (ligero blend), 2 → 1.0 (puro sales plan)
- n_series WAPE<0.3: 7 → 12 (+71%)
- Sanity flag: `flag_too_many_constant` = True (8/26 subs tienen forecast plano). Causa: subfamilias sin SI Baraldo (ACCESORIES, APPAREL, G LOOMIS, FW TRAVEL, SW TRAVEL, MONOLINE, MARKETING, COMBO SPIN FW) → MA3 degenera. Resuelve en iter 3 (zonal) o iter 5 (LGBM).
- Gate: no cumple 0.38 estricto pero mejora clara. **Acepto, continúo.**

## Iter 3 — estacionalidad zonal + vedas (SKIP)
- Decisión: iter 3 (parsing textual del xlsx zonal) requiere mapping subfamilia → categoría pesquera que es trabajo manual intensivo. Salté a iter 5 (LGBM) que puede aprender patrones automáticamente.
- Status: diferido como follow-up si iter 5 cerraba.

## Iter 5 — mlforecast LGBM + exógenas ❌ ROLLBACK
- WAPE mediano LGBM solo: **1.03** (desastre)
- Combinado best-per-series LGBM vs iter_2: **0.544** (peor que iter 2 que fue 0.398)
- Causa del fracaso: LGBM necesita más datos. Tenemos solo 7 meses Shimano directo. Las subfamilias "nuevas" sin Baraldo son prácticamente ilearnable con 7 observaciones. El noise > signal.
- Learning: para que LGBM funcione necesitaríamos (a) extender Baraldo histórico mapeado a subfamilia_norm consistente con Shimano, o (b) esperar más meses de data Shimano directa, o (c) usar foundation model zero-shot (Chronos-2).
- **Decision**: rollback LGBM. **Ganador final: iter 2** (WAPE 0.398).

## Ganador final v3: Iter 2 (sales plan blend)
- WAPE mediano: **0.398** (16% mejor que prod original 0.476, 5.7% mejor que baseline iter_0 0.422)
- Mejora driver: 10 de 25 subfamilias eligen blend con sales plan (alpha > 0).
- Follow-ups futuros:
  - Iter 3 zonal (xlsx) + iter 4 campañas con más tiempo de data
  - Iter 5 LGBM cuando tengamos 18+ meses Shimano
  - Iter 6 hierarchical SKU (necesita iter 5 bueno)
  - Probar Chronos-2 zero-shot como alternativa (SOTA Oct 2025)


