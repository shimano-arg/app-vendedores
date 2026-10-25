# 44 - Auditoría cadencia syncSapCatalogStockCF (2026-10-25)

**Autor**: Loop verificación cadencia CF Gen 2 scheduled
**Fecha**: 2026-10-25
**Veredicto**: **FAIL** - cadencia CF NO cumple el criterio de ≤15 min entre ejecuciones consecutivas en la ventana auditada.

## Objetivo

Verificar si la CF `syncSapCatalogStockCF` (Gen 2 scheduled cada 5 min, deployada por v1444 2026-10-22) opera con cadencia suficiente para reemplazar al workflow GHA `sync-sap-catalog-stock.yml` (cron Python cada 5 min declarado, cadencia efectiva observada 2-5 h por scheduler saltos).

Si la CF es confiable (≤15 min entre ejecuciones) se procedería a:
- Apagar `schedule:` del workflow Python (dejar sólo `workflow_dispatch`).
- Bajar `SNAPSHOT_MAX_AGE_MS` de 8 h a 30 min en `functions/core/commit-pedido-core.js`.
- Ajustar umbrales del badge SAP en `index.html` a 5/30 min.

## Criterio de aceptación

> Desde el viernes 2026-10-23 16:25 ART (deploy inicial CF v1444) hasta ahora, **NO** debe haber huecos > 15 minutos en la cadencia de ejecución del `syncSapCatalogStockCF`.

## Metodología

1. Query Cloud Logging:
   ```
   gcloud logging read \
     'resource.type=cloud_run_revision AND resource.labels.service_name=syncsapcatalogstockcf AND textPayload:"syncSapCatalogStockCF summary"' \
     --project=app-vendedores-shimano \
     --freshness=3d \
     --limit=1000 \
     --format='value(timestamp)' \
     --order=desc
   ```
2. Timestamps ordenados ascendente.
3. Delta en minutos entre ejecuciones consecutivas.
4. Flag `> 15 min` = hueco relevante.

## Métricas (ventana auditada)

| Métrica                | Valor                                               |
| ---------------------- | --------------------------------------------------- |
| Total ejecuciones      | **620**                                             |
| Período UTC            | 2026-10-23 19:25:22 → 2026-10-25 23:17:57           |
| Período ART            | 2026-10-23 16:25:22 → 2026-10-25 20:17:57           |
| Max delta              | **23.89 min**                                       |
| Min delta              | 3.63 min                                            |
| Avg delta              | 5.03 min                                            |
| Mediana                | 5.00 min                                            |
| Huecos > 15 min        | **1**                                               |

### Distribución de deltas

| Bucket    | #   | %      |
| --------- | --- | ------ |
| < 4 min   | 1   | 0.2 %  |
| 4-5 min   | 291 | 47.0 % |
| 5-6 min   | 326 | 52.7 % |
| 6-10 min  | 0   | 0.0 %  |
| 10-15 min | 0   | 0.0 %  |
| **> 15 min** | **1** | **0.2 %** |

El 99.8 % de los deltas están entre 3.6 y 6 min. Hay **1 outlier** que rompe el criterio.

## Hueco encontrado

| timestamp inicio (UTC) | timestamp fin (UTC) | delta (min) | causa |
| ---------------------- | ------------------- | ----------- | ----- |
| 2026-10-23T20:00:25Z   | 2026-10-23T20:24:18Z | **23.89**   | `DEPLOYMENT_ROLLOUT` a las 20:13:41 UTC (deploy nueva revisión Cloud Run) |

### Evidencia del hueco (logs Cloud Logging)

```
2026-10-23T20:00:25.104242Z  syncSapCatalogStockCF summary { ok: true, itemsSynced: 776, withStock: 342, durationMs: 19783 }
2026-10-23T20:13:41.185038Z  INFO  Starting new instance. Reason: DEPLOYMENT_ROLLOUT - Instance started due to traffic shifting between revisions due to deployment, traffic split adjustment, or deployment health check.
2026-10-23T20:13:45.074853Z  INFO  Default STARTUP TCP probe succeeded after 1 attempt for container "worker" on port 8080.
2026-10-23T20:24:00.375019Z  INFO  (próxima scheduled run)
2026-10-23T20:24:18.679765Z  syncSapCatalogStockCF summary { ok: true, itemsSynced: 776, withStock: 342, durationMs: 17529 }
```

El scheduler Cloud Scheduler ejecuta cada 5 min, pero el **despliegue de una nueva revisión** interrumpe el próximo tick: la revisión vieja ya no acepta tráfico y la nueva no está lista hasta que termine el startup probe. En este caso la nueva revisión arrancó a las 20:13:41 UTC pero el próximo tick scheduled no ocurrió hasta las 20:24:00 UTC (una ventana de ~20 min sin ejecución efectiva).

## Deploys detectados en la ventana auditada

```
2026-10-23T19:19:45Z  DEPLOYMENT_ROLLOUT (antes del inicio de la ventana requerida, no genera hueco)
2026-10-23T20:13:41Z  DEPLOYMENT_ROLLOUT (CAUSA del hueco de 23.89 min)
2026-10-25T23:16:19Z  DEPLOYMENT_ROLLOUT (al final de la ventana, próximo tick cae fuera del rango auditado)
```

Es decir: **cada deploy a la CF genera un hueco potencial de ~15-25 min** porque el scheduler no re-trigger inmediatamente al terminar el rollout. En un día con 1-2 deploys, se producirá al menos 1 hueco > 15 min.

## Veredicto

**La CF `syncSapCatalogStockCF` NO está lista para reemplazar al workflow GHA Python en este momento.**

Fundamento:
- 1 hueco de 23.89 min encontrado en la ventana auditada (2026-10-23 19:25 UTC → 2026-10-25 23:17 UTC).
- Causa raíz: `DEPLOYMENT_ROLLOUT` de la Cloud Function interrumpe el ciclo scheduled.
- La causa NO es un defecto operativo persistente (no es SL login fail, timeout, etc.), pero sí es un **modo de falla recurrente**: cada vez que se deploya `functions/scheduled/sync-sap-catalog-stock.js` o cualquier CF del mismo contenedor Cloud Run, se producirá un hueco similar.
- Si se baja `SNAPSHOT_MAX_AGE_MS` a 30 min y la CF está en rollout durante un deploy, los pedidos commiteados en esa ventana podrían recibir `SNAPSHOT_TOO_OLD` por falsos negativos (snapshot de 25 min cuando el usuario commitea 29 min después del último tick).

**NO** se apaga el workflow GHA Python.
**NO** se baja `SNAPSHOT_MAX_AGE_MS`.
**NO** se tocan los umbrales del badge.

## Recomendaciones

### Fix propuesto para re-habilitar el cierre de #5 + #6

1. **Scheduler Cloud Scheduler out-of-band**: usar un Cloud Scheduler job separado que llame al endpoint HTTP de la CF (en vez del scheduler nativo de Cloud Functions Gen 2 scheduled). Durante un rollout, el scheduler sigue triggereando y Cloud Run routing envía los calls a la revisión que esté lista; si ambas revisiones están OK, no hay hueco.
2. **Alternativa simpler**: Dejar el workflow GHA Python ENCENDIDO como safety net durante deploys. La CF corre cada 5 min, el GHA cada 5 min declarado (2-5 h efectivo). Snapshot efectivo = min(CF, GHA). Pero esto no soluciona el goal real (bajar `SNAPSHOT_MAX_AGE_MS`).
3. **Alternativa pragmática**: Aceptar huecos durante deploys y agregar lógica en `commitPedidoCF` que **tolere** 1 outlier por día (ej. si snapshot age > 30 min pero hubo un deploy reciente, re-usar `SNAPSHOT_MAX_AGE_MS=1h` para esa transacción). Complejidad alta, poco gain.
4. **Opción nuclear**: Separar `syncSapCatalogStockCF` a su propia Cloud Function (no compartir contenedor con otras CFs del repo) para reducir frecuencia de deploys de ese módulo. Si `functions/scheduled/sync-sap-catalog-stock.js` sólo cambia 1-2 veces al mes, los huecos serían raros.

### Próximos pasos

1. **Re-verificar en 72 h** (lunes 2026-10-28) con ventana limpia (sin deploys). Si en 72 h sin deploy no aparece ningún hueco > 15 min por otra causa, el fix sería "pausar deploys de CF durante el cierre de #5+#6".
2. **Decidir fix estructural** antes de re-intentar: opción 1 (scheduler out-of-band) parece la de menor costo-impacto.
3. **No tocar #5 ni #6 hasta que el fix esté validado.**

## Métricas resumen (devueltas al parent agent)

- **Veredicto**: FAIL
- **Total ejecuciones**: 620
- **Max delta**: 23.89 min
- **Min delta**: 3.63 min
- **Promedio**: 5.03 min
- **Mediana**: 5.00 min
- **Huecos > 15 min**: 1 (causado por `DEPLOYMENT_ROLLOUT` 2026-10-23 20:13:41 UTC)
