# Pipeline Forecast v2 — Shimano app-vendedores

Pipeline offline de forecasting estadístico multivariado para app-vendedores.
Corre mensual manual, entrena baseline + jerárquico con exógenas, publica
resultado a Firestore `forecast_output/{sku}` que consume el modal FORECAST.

Estado: **F2A.1 baseline** (2026-09-30). No escribe Firestore aún.

## Estructura

```
scripts/forecast/
├── inputs/
│   ├── Estacionalidad_Pesca_por_Zona.xlsx    # semilla Mariano (5 hojas)
│   ├── exogenas.csv                            # macro país (REM/dólar/tasas/electoral/torneos)
│   ├── torneos.csv                             # calendario torneos (input de exogenas.csv)
│   └── dolar_futuro_detalle.csv                # auditoría cálculo dolar_futuro_12m
├── output/                                     # generado por scripts
│   ├── ventas_mensuales.csv
│   ├── ventas_mensuales_regrid.csv
│   ├── backtest_por_sku.csv
│   ├── backtest_agregado.csv
│   ├── forecast_h7.csv
│   └── resumen.json
├── build_exogenas.py                           # regenera inputs/exogenas.csv desde fuentes (Cowork)
├── reporte_exogenas.md                         # notas de Cowork sobre exogenas.csv
├── train_baseline.py                           # F2A.1: baseline Naive/SeasonalNaive/AutoARIMA
├── requirements.txt
└── README.md
```

## Requisitos

- Python 3.11+
- Service Account JSON en `~/Desktop/sa-key.json` con permisos `BigQuery Data Viewer` +
  `BigQuery Job User` (para F2A.4 en adelante también `Firestore User`).
- `pip install -r scripts/forecast/requirements.txt`

## Fases

### F2A.1 (esta versión) — Baseline sin exógenas ni jerarquía

```bash
python scripts/forecast/train_baseline.py
```

- Query BQ `v_ventas_lineas` filtrando `is_pesca=TRUE` desde 2022-01.
- Agregado mensual por `item_code × YYYY-MM` (SUM `cantidad`).
- Reindex a grilla mensual regular (meses sin venta = 0).
- Filtro: SKUs con al menos 12 meses de historia.
- Modelos: `Naive`, `SeasonalNaive(12)`, `AutoARIMA(season_length=12)`.
- Backtest: `cross_validation` con `h=7`, `n_windows=3`, `step_size=7`.
- Métricas: MAE, RMSE, MAPE (excluyendo `y=0`), WAPE (weighted MAPE global).
- Elige mejor modelo por SKU por WAPE mínimo.
- Escribe forecast H=7 con el mejor modelo por SKU en `forecast_h7.csv`.

**Objetivo**: ver el piso de MAPE/WAPE por familia con el baseline puro.
Si es prohibitivo (WAPE mediano > 1.0 en todas las familias) reconsideramos
scope antes de invertir en jerarquía + exógenas.

### F2A.2 — Hierarchical (pendiente)

Agrega reconciliación familia → subfamilia → SKU con `hierarchicalforecast`
(MinT bottom-up). Compara vs baseline puro.

### F2A.3 — Exógenas (pendiente)

Suma:
- **Macro país** desde `inputs/exogenas.csv` + derivados (`brecha_mep`,
  `devaluacion_implicita_12m`) para evitar colinealidad de niveles nominales
  (ver `reporte_exogenas.md` § "Niveles nominales").
- **Calendario pesquero zonal** derivado de
  `inputs/Estacionalidad_Pesca_por_Zona.xlsx` en un script auxiliar
  `build_features_from_estacionalidad.py` (aún no escrito) → produce
  `calendario_zonas_meses.csv`, `vedas_zonas_meses.csv`,
  `sku_to_categoria_foco.csv`. Se cruza con `sku → familia` + peso zonal
  histórico por SKU (fracción de ventas por zona).

### F2A.3 — Advanced / decomposition / prod (COMPLETADO 2026-09-30)

Tras F2A.1 baseline (WAPE mediano ~1.0), 3 iteraciones para llegar a
**WAPE mediano 0.476** en 24 subfamilias:

- **iter 1** `train_advanced.py` — Baraldo smooth-3m + exógenas macro +
  LightGBM + AutoARIMA/AutoETS/MSTL + ensemble mediana → WAPE 1.0 (falla:
  régimen partido en 2025-09 confunde a los modelos que unifican train).
- **iter 2** `train_seasonal.py` — cambio radical: modelar SOLO con datos
  post-splice, usar Baraldo únicamente para índice estacional (SI). Backtest
  h=2 w=3. → WAPE 1.0 (falla: v_ventas_lineas con is_pesca=TRUE solo tiene
  8 meses, filtro rompía la vista).
- **iter 3** `train_final.py` — mapping externo desde `Articulos.xlsx`
  (catálogo maestro, 6717 items) bypass v_ventas_lineas. Query directo
  sap_invoices_raw + credit_notes. Seasonal decomposition (SI Baraldo ×
  nivel Shimano). → **WAPE 0.495 ✓ goal cumplido**.
- **iter 4 (PROD)** `train_prod.py` — refinamiento: cap del trend (evita
  overshoot cuando slope × horizon >> level), ensemble ponderado por 1/WAPE
  (no mediana simple), reporte publicable. → **WAPE 0.476, 25% series
  WAPE<0.3, 54% WAPE<0.5, 67% WAPE<0.7**.

**Modelos evaluados**: Naive, MA3, SeasonalNaive_YoY, Seasonal_Level,
Seasonal_Trend (con cap), Seasonal_MA3, Ensemble_Weighted (media ponderada
por 1/WAPE).

### F2A.4 — Publish Firestore (COMPLETADO 2026-09-30)

`publish_to_firestore.py` lee `output/prod_forecast_h7.csv` + `prod_best_per_series.csv`
y escribe:
- `forecast_output/{subfamilia_slug}` — 24 docs, uno por subfamilia con
  forecast H=7 + IC80% + metrics + bestModel + versionId.
- `forecast_output_meta/current` — resumen global.

Rules Mariano-only (whitelist email) — ver firestore.rules § v1099.

### F2A.5 — Script end-to-end (pendiente)

`train_and_publish.py` unifica prod + publish en un solo comando mensual.

## Uso operativo mensual (post-F2A.4)

Cada 1° del mes:
```bash
python scripts/forecast/train_prod.py            # 30-60 seg
python scripts/forecast/publish_to_firestore.py  # 5 seg
```

Chequear en `output/prod_publicable.md` el reporte y en Firestore
`forecast_output_meta/current` la versionId.

## Regeneración mensual de exógenas

```bash
python scripts/forecast/build_exogenas.py scripts/forecast/inputs
```

Trae ~5 min. Requiere internet + `torneos.csv` al lado del script.
Ver `reporte_exogenas.md` para detalle de fuentes y warnings.
