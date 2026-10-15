# Plan Forecast v3 — mejora iterativa con validación anti-alucinación

**Owner**: Mariano (Shimano Argentina)
**Started**: 2026-10-14
**Status**: in-progress
**Goal**: Reducir WAPE mediano del forecast desde el baseline actual (0.476 por subfamilia × 7m) sumando datos de la app + SAP + señales reales de demanda que hoy no se usan.

## Reglas duras (anti-alucinación)

1. **Métrica única comparable iter-vs-iter**: WAPE mediano across subfamilias en backtest rolling-origin h=2, w=3 ventanas. Sin cambiar la ventana entre iters.
2. **Baseline inmutable**: iter 0 reproduce `train_prod.py` y confirma WAPE 0.476. Si no reproduce, STOP (bug introducido).
3. **Skip criteria**: si una iter N agrega una señal y WAPE **sube** respecto a iter N-1, rollback de la feature (no se queda "por sentimiento"). Documentar WHY.
4. **Validator agent después de cada iter**: dispatcho `silent-failure-hunter` + manualmente chequeo que las predicciones no son constantes, no son todas = último mes, no son todas = ensemble sin la nueva feature.
5. **Métricas secundarias**: BIAS, MAE, RMSE, coverage IC 80%, n_series_wape_lt_0_3. Todas se reportan por iter.
6. **Sanity checks por iter**:
   - WAPE no mejora >50% (si pasa, probable leak)
   - BIAS no cambia de signo radicalmente (si pasa, cambio semántico de target no deliberado)
   - El modelo elegido por series cambia en >70% (si pasa, puede haber overfitting al featuresnuevo)
7. **Reproducibilidad**: cada iter guarda `iter_N_resumen.json` con fecha, hash del commit, WAPE/MAE/BIAS, modelo ganador por subfamilia, lista de features usadas.

## Fases + gates

| Iter | Objetivo | Features sumadas | Esperado WAPE | Gate pasa si |
|---|---|---|---|---|
| **0 (baseline)** | Reproducir `train_prod.py` sin cambios | ninguna (solo histórico + SI Baraldo) | 0.422 (nuevo con 7m Shimano; el 0.476 del prod_resumen.json era con 6m) | **CONFIRMADO 2026-10-14** |
| **1 (target real)** | Reescribir target: `demanda = venta_facturada + backorder_abierto_mes` para capturar demanda insatisfecha | `v_backorder_app` BQ + `pedidos_raw_raw_changelog` (reconstruye history BO→invoiced) | ≤ 0.40 | WAPE baja ≥ 0.02 Y BIAS no vuela |
| **2 (sales plans anchor)** | Usar sales plans como anchor para meses futuros ("qty mínima esperada") | `sales_plan_cache` Firestore (2 docs: rods + reels) | ≤ 0.38 | WAPE baja Y n_series_wape_lt_0_3 sube |
| **3 (estacionalidad zonal)** | Reemplazar SI nacional por SI zonal × share zonal del SKU | xlsx `Estacionalidad_Pesca_por_Zona.xlsx` (5 hojas: Resumen/Calendario/Detalle mensual/Equipos por especie/Vedas) | ≤ 0.36 | WAPE baja Y vedas se respetan (test manual: pejerrey BA sept-nov forecast << pico marzo) |
| **4 (campañas)** | Feature `has_active_campaign` + `target_amount_mes` + lag del uplift histórico | `campaigns` + cruzar contra ventas post-campaña | ≤ 0.34 | WAPE baja Y uplift esperado se refleja en meses con campaña |
| **5 (promover mlforecast LGBM + ensemble)** | Combinar features 1-4 en LGBM via Nixtla mlforecast, blend ensemble ponderado 1/WAPE con los seasonal estadísticos | Todo lo anterior + exógenas macro | ≤ 0.32 | WAPE baja Y modelo elegido es LGBM en ≥ 30% subfamilias |
| **6 (hierarchical SKU)** | Bajar de subfamilia a SKU via proporciones + MinT reconciliation con `hierarchicalforecast`/Darts | SKU shares últimos 6 meses | WAPE SKU ≤ 0.60 (es más ruidoso) | Coherencia: Σ forecast SKU ≈ forecast subfamilia (tolerancia 5%) |

## Agentes por iter

Cada iter dispara:
1. **Build pipeline**: Python script que lee features nuevas + corre backtest + genera `iter_N_resumen.json`.
2. **Validator agent `silent-failure-hunter`**: review del diff Python para catch bugs comunes (fecha mal, split train/test leak, series vacías).
3. **Validator agent `data-science-reviewer`** (custom prompt): valida que las predicciones no son sanity-breaking (constantes, negativas, 100x el histórico).
4. **Me (Opus)**: comparo tabla WAPE N vs N-1, aplico skip criteria, decido si avanzamos o rollback.

## Datos a usar (inventario esperado)

**En espera de completar via code-explorer agent dispatchado**. Áreas de búsqueda:

- `pedidos` Firestore (state histórico BO/ASIG/confirmed con createdAt)
- `sales_plans` Firestore (upload Mariano via modal FORECAST)
- `campaigns` + `archived campaigns` Firestore
- BQ `sap_invoices_raw` + `credit_notes` (ya usa)
- BQ `sap_items_raw` (catálogo)
- `app_config/stock_snapshot` (histórico si tenemos)
- `Estacionalidad_Pesca_por_Zona.xlsx` (ya en inputs, no leído)
- `inputs/exogenas.csv` (ya existe, no leído por PROD)
- `inputs/torneos.csv` (ya existe, no leído por PROD)

## Estructura archivos

```
scripts/forecast/v3/
├── common/
│   ├── config.py           # BQ project, paths, horizonte, backtest params
│   ├── metrics.py          # WAPE, MAE, BIAS, RMSE compartidas
│   ├── backtest.py         # rolling-origin común
│   └── data_sources.py     # loaders Firestore + BQ (cached)
├── iter_0_baseline.py      # reproduce train_prod
├── iter_1_demand_real.py   # + backorder target
├── iter_2_sales_plans.py   # + sales plans anchor
├── iter_3_zonal.py         # + SI por zona + vedas
├── iter_4_campaigns.py     # + campañas
├── iter_5_lgbm.py          # + LGBM + ensemble
├── iter_6_sku.py           # + hierarchical SKU
├── output/
│   ├── iter_0_resumen.json
│   ├── iter_1_resumen.json
│   └── ...
└── RUN_LOG.md              # resumen cronológico cada iter
```

## Validador manual por iter (checklist)

- [ ] WAPE mediano baja respecto a iter previa (o cumple criterio de gate)
- [ ] No hay series con WAPE = 0 exacto (señal de leak)
- [ ] BIAS ∈ [-0.3, 0.3] (sin sesgo sistemático)
- [ ] Forecast horizonte 7m no es constante por subfamilia
- [ ] Forecast en mes de veda conocida (ej. pejerrey BA sept-nov) está debajo del promedio
- [ ] Forecast en mes de torneo grande conocido está arriba del promedio (si la señal se incluyó)
- [ ] Σ forecast todos los meses ≠ 7 × último mes real (si lo es, modelo colapsó a naive)

## Rollback plan

Si en cualquier iter el WAPE sube Y la causa no se identifica en 30 min:
1. Revertir código al commit anterior
2. Documentar en `RUN_LOG.md` qué se intentó y por qué no funcionó
3. Saltar a la siguiente iter (no empeñarse)

## Finalización

Deploy a prod requiere:
- WAPE final mediano ≤ 0.40 (o justificar por qué no se llegó)
- Mariano aprueba el resumen final
- `publish_to_firestore.py` corre y `forecast_output/{sku}` se actualiza
- Modal FORECAST en la app muestra la nueva predicción

---

**Próximo paso**: completar inventario de datos (agent corriendo) → iter 0 baseline reproduce.
