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

### F2A.4 — Firestore output (pendiente)

Escribe `forecast_output/{sku}` con `{forecast, metrics, versionId, generatedAt}`.
Rules `sales_plan_cache`-style (Mariano-only read/write).

### F2A.5 — Script end-to-end (pendiente)

`train_and_publish.py` unifica los 3 pasos anteriores en un solo comando
mensual.

## Regeneración mensual de exógenas

```bash
python scripts/forecast/build_exogenas.py scripts/forecast/inputs
```

Trae ~5 min. Requiere internet + `torneos.csv` al lado del script.
Ver `reporte_exogenas.md` para detalle de fuentes y warnings.
