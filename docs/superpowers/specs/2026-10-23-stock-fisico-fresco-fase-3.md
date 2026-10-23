# Stock físico fresco en toda la cadena — Fase 3 (3 capas) · Design doc

**Autor**: Claude Opus 4.7 (bajo instrucciones de Mariano)
**Fecha**: 2026-10-23
**Rama**: `feat-stock-fisico-fresco-f3` desde `main` (v1443).
**Base**: Fase 1 (§63 `releaseAsigCF`, PR #1192) + Fase 2 (§64 logging STOCK_CHANGED, PR #1193) shippeadas.
**Scope**: 3 capas secuenciales. Capa 2 depende de 1 estable. Capa 3 depende de 1 verificada 2 días.
**Estado**: **PENDIENTE DE AUTORIZACIÓN**. No codear hasta OK Mariano sobre este doc.

---

## 0. Objetivo

Que el **stock físico** del depósito 11 esté fresco en 3 puntos:
1. **Sync server-side**: lo escribe un job propio cada 5 min (no un cron de GHA que saltea).
2. **UI**: la pantalla "Pedido en espera" lo consulta en vivo al Service Layer al abrir.
3. **Validación atómica**: `commitPedidoCF` lo consulta en vivo al validar, antes del throw STOCK_CHANGED.

Reservas (ASIG, confirmed, waitlist CPST) ya son en vivo porque viven en Firestore y onSnapshot las propaga en segundos. Lo único stale es el **físico** (`app_config/stock_snapshot.warehouseBreakdown`).

El umbral §60 `SNAPSHOT_MAX_AGE_MS = 8h` fue un parche de 2026-10-23 para destrabar prod porque el GHA saltea. Esta fase lo cierra: Capa 1 asegura `age < 15 min` real; Capa 2 cubre la ventana <5 min con live query; Capa 3 baja el umbral a 30 min como red de seguridad.

**NO objetivo**: cambiar la fuente de reservas, cambiar la lógica de breakdown §39, migrar el forecast, migrar BigQuery.

---

## 1. Diagnóstico actual

### Qué entra al snapshot y con qué cadencia

- **Fuente**: `scripts/sync_sap_to_firestore.py` corre via workflow `sync-sap-catalog-stock.yml`.
- **Cron declarado**: `'2,7,12,17,22,27,32,37,42,47,52,57 * * * *'` (cada 5 min, offset 2).
- **Cron efectivo**: GHA scheduler saltea corridas cuando la cola de workflows gratuitos se satura. Observado en el repo histórico (ver §60 CLAUDE.md): runs reales cada 2–5 horas.
- **Doc destino**: `app_config/stock_snapshot`. Shape actual:
  ```
  {
    updatedAt: Timestamp,
    stock: { [sku]: boolean },         // flag "has_stk" (dep 11 > 0, §26)
    quantities: { [sku]: number },     // sum ALL_SALES wh (excluye 05/06)
    warehouseBreakdown: { [sku]: { [whsCode]: number } },  // granular por whs
    _syncMeta: { batchId, duration, items }
  }
  ```

### Qué lee ese snapshot

- **Cliente**: `index.html:ensureStockSnapshotListener` (onSnapshot) → poblar `window._stockSnapshot` + `window._stockFisicoBySku` → usados por `getStockBreakdown` del `src/pure/stock-breakdown.js` para computar `fisicoDep11`.
- **CF `commitPedidoCF`**: `commit-pedido-core.js:316` lee `app_config/stock_snapshot.warehouseBreakdown[sku]['11']` directo adentro de la validación. También evalúa `age = now - updatedAt.toMillis()` para disparar `SNAPSHOT_TOO_OLD` (§60, 8h).
- **CF `onDep11IncreaseCreateReparto`**: trigger onWrite sobre `app_config/stock_snapshot` → crea `ingresos_reparto` al detectar aumento en dep 11.
- **CF `autoConfirmPendingPedidosCF`**, `syncSapInvoicesToApp`, `syncSapOrdersToApp`, popup Stock del SKU, Master de productos, etc.

### Qué otra fuente podríamos usar

El Service Layer SAP (B1 SL) tiene el físico actualizado al segundo. La consulta canónica:

```
GET /b1s/v1/Items('<SKU>')?$select=ItemCode,ItemWarehouseInfoCollection
```

o para batch:

```
GET /b1s/v1/Items?$select=ItemCode,ItemWarehouseInfoCollection&$filter=ItemCode eq 'A' or ItemCode eq 'B' or ...
```

Donde `ItemWarehouseInfoCollection` es un array con `{WarehouseCode, InStock, Committed, Ordered, ...}`. Para físico dep 11 nos interesa `.find(w => w.WarehouseCode === '11').InStock`.

**Limitación conocida (empírica, ver §4 abajo)**: SL rechaza queries con `$filter` demasiado largo. El tamaño exacto del límite hay que medirlo contra prod.

---

## 2. Arquitectura — 3 capas

### Capa 1 — Sync confiable (Cloud Scheduler + CF)

**Qué cambia**:
- Nueva CF `syncSapCatalogStockCF` (scheduled onSchedule cada 5 min, region `southamerica-east1`).
- Cloud Scheduler job manejado por `firebase deploy --only functions` (Firebase Functions scheduler se auto-crea).
- Misma lógica de `scripts/sync_sap_to_firestore.py`: login SL → paginar Items → calcular por whs → `stock_snapshot.set()`.
- **Diferencia clave 1**: escribe un campo nuevo `source` en el snapshot con valor `'cf-scheduled'` o `'gha-cron'` o `'manual-dispatch'`.
- **Diferencia clave 2**: escribe también `_syncRun` con `{startedAt, finishedAt, durationMs, itemsSynced, errors, cfInstance}` para auditoría.
- Log de cada corrida en `operations_log` con `type='stock_sync_run'`.
- Alerta: si pasan > 15 min sin corrida exitosa, escribir doc `alerts/stock_sync_stale` + email (reusar `functions/core/send-email-core.js` si existe).

**Rollout paralelo 2 días hábiles**:
- Días 1-2: CF corre cada 5 min + GHA cron sigue en los mismos minutos. Ambos escriben al mismo doc; el último gana. El campo `source` deja ver quién ganó.
- Si al día 2 la CF corrió 288 corridas × 2 días = 576 corridas sin huecos > 15 min → apagar cron GHA (dejar solo `workflow_dispatch` como respaldo manual).
- Si hay huecos: investigar antes de apagar GHA. No cerrar la capa 1.

**Scope DEL CÓDIGO**:
- `functions/core/sync-sap-catalog-stock-core.js` nuevo (port 1-a-1 de la lógica de Python a JS/Node, usando `node-fetch` del SDK admin).
- `functions/index.js` export `syncSapCatalogStockCF` como `onSchedule('*/5 * * * *')`.
- `functions/core/sap-sl-session.js` nuevo (helper para login + session reuse — ver §Sesiones abajo).
- Workflow `sync-sap-catalog-stock.yml`: comentar el `schedule:` dejando solo `workflow_dispatch:`.

**Costo mensual estimado** (ver §5 Costo).

### Capa 2 — Live SL en vivo al abrir y al confirmar

**Qué cambia (cliente)**:
- Al abrir el modal "Pedido en espera" (`_renderWaitlistCard`), **antes** del render, hacer un GET al SL via nuevo callable `fetchStockLiveCF({ skus: [...] })`.
- Response: `{ ok: true, fisicoDep11: { [sku]: number }, snapshotFallback: boolean, snapshotAgeMs: number | null }`.
- Si `ok=true` y `snapshotFallback=false`: usar `fisicoDep11` en `getStockBreakdown` reemplazando el valor del snapshot. UI muestra badge "Stock en vivo · ok" junto al título.
- Si `snapshotFallback=true`: usar snapshot normal + badge "Stock de hace X min · SL no respondió" junto al título.
- Error de red callable: idem, badge "SL caído, usando snapshot".

**Qué cambia (CF `commitPedidoCF`)**:
- Antes del compute breakdown por SKU (`commit-pedido-core.js:347`), llamar al mismo helper `fetchStockLiveFromSL(skus, deps)`.
- Si `ok=true`: usar `fisicoDep11` live en lugar de `warehouseBreakdown[sku]['11']`.
- Si falla pero snapshot fresco (<8h): usar snapshot + log en `operations_log` con `type='commit_pedido_validated_with_snapshot'`, `reason='sl_timeout'|'sl_error'|'sl_not_enabled'`, `snapshotAgeMs`.
- Si falla y snapshot vencido (>8h → >30min después de capa 3): throw nuevo errorCode `SAP_UNAVAILABLE` con mensaje "SAP no respondió y el último sync de stock fue hace Xh. Reintentá en unos minutos; si persiste contactá admin." + canRefresh=false.

**Query batch** (ver §4 medición):
- Siempre batch, nunca secuencial.
- Un GET con `$filter=ItemCode eq 'A' or ItemCode eq 'B' or ...` + `$select=ItemCode,ItemWarehouseInfoCollection`.
- Si N > 50 (o lo que mida el experimento), partir en bloques de 50 y concatenar.
- Timeout TOTAL 3 segundos por pedido (no por bloque). Si no entra: consultar solo "líneas en riesgo" (`qty_pedida >= libre_snapshot[sku]`) + resto va con snapshot. Log en operations_log con `type='stock_live_partial'`.

**Helper único §39** `src/pure/stock-breakdown.js:getStockBreakdown` ya existe + espejo `functions/core/pedido-snapshot-core.js`. El cambio: aceptar un parámetro opcional `fisicoDep11Override` que, si viene, se usa en lugar de `getStockFisico(sku)`. Mirror sync test (§57) actualizado.

**Qué NO cambia**: popup Stock del SKU en Master de productos, modal Dashboard, Forecast, panel SAP, exports — siguen leyendo del snapshot. La live query es solo para el flow Pedido en espera + commitPedidoCF.

### Capa 3 — Cerrar el parche §60

Cuando capa 1 corra sin huecos > 15 min durante 7 días:
- `functions/core/commit-pedido-core.js:SNAPSHOT_MAX_AGE_MS` baja de `8 * 60 * 60 * 1000` a `30 * 60 * 1000`.
- Badge "Sync stock" del cliente (`index.html:_updateSapHealthBadge`) ajusta umbrales: `< 10 min` fresh, `10-30 min` stale, `>= 30 min` muy stale.
- CLAUDE.md §60 documenta el cierre con fecha + referencia a capa 1 shippeada.
- Tests del threshold en `tests/functions/commit-pedido-snapshot-too-old.test.js` actualizados.

---

## 3. Sesiones SL — manejo

El SL de SAP B1 impone cupo de sesiones concurrentes. En producción Shimano hoy el cupo es **5 sesiones concurrentes** (confirmado en incident reports previos, ver audit `test_sl_sqlqueries.py`). Si se excede, nuevos logins devuelven HTTP 400 "You are not allowed to log in" con body `-7`.

### Estrategia

- **Session pool centralizado** en `functions/core/sap-sl-session.js`:
  - Mantiene hasta `N_SL_SESSIONS` cookies vivas en memoria del CF container (default `N=2`, parametrizable por env var `SL_SESSION_POOL_SIZE`).
  - Cada sesión tiene `createdAt` + `lastUsedAt`. Expira a los 25 min (SL default `IdleTimeout`=30, margen 5).
  - Un mutex (Promise queue) impide que 2 llamadas intenten usar la misma sesión en paralelo.
  - Si todas las sesiones ocupadas Y hay cupo → crear nueva. Si no → `await` la primera que libere.
- **Compartido entre CFs** (`commitPedidoCF`, `syncSapCatalogStockCF`, `fetchStockLiveCF`, trigger `onPedidoConfirmedSendToSap`, etc.) via `globalThis` del container.
- **Cuidado**: Firebase Functions Gen 2 recicla containers; el pool se re-crea en cold start. OK, es best-effort.

### Carga sobre SAP

Con **N=2** sesiones + 288 corridas sync/día + 100-200 live queries/día + envío de SO/SQ ocasional:
- Sync Scheduled: 1 sesión activa por ~15s (duración actual del sync Python ~10-15s con ~6000 Items, chunks de 20 por limit SL).
- Live query commit: ~50-200ms (ver §4 medición).
- Live query modal: idem.
- Pico de concurrencia: raro que > 2 CFs en paralelo pidan sesión. 2 sesiones es generosamente suficiente.

**Decisión**: `N_SL_SESSIONS=2` por default. Si en producción se observa HTTP 400 cupo excedido → subir a 3 y ajustar `IdleTimeout` del SL.

---

## 4. Medición de latencia real del SL — PASO 0

**Prerrequisito antes de arrancar código**: medir contra el SL de prod `shimano-arg.coresuite.net:50000` (dominio real tomado de `app_config/sap_integration.serviceLayer.url`) la latencia de:

1. `GET /b1s/v1/Items('<SKU-A>')?$select=ItemWarehouseInfoCollection` — 1 SKU único.
2. `GET /b1s/v1/Items?$filter=ItemCode eq 'A' or ItemCode eq 'B' or ... (20 SKUs)&$select=ItemCode,ItemWarehouseInfoCollection` — batch 20.
3. Idem con **80 SKUs** → si falla (414 URI Too Long o similar), medir split en 2 batches de 50 + 30.

### Script de medición

Nuevo archivo `scripts/perf/sl_batch_latency.py`:

```python
"""
Mide latencia batch del Service Layer SAP para GET /Items con $filter+$select.

Uso: python scripts/perf/sl_batch_latency.py --skus=20 --repeat=5
     python scripts/perf/sl_batch_latency.py --skus=80 --repeat=5

Lee creds de Firestore app_config/sap_integration.serviceLayer (mismo patrón
que sync_sap_to_firestore.py). Imprime median, p95, p99 de latencia por bloque
+ status codes observados + tamaño del response body.

NO modifica nada en SAP. Es puro GET.
"""
# [cuerpo del script omitido en el design — pendiente de implementación]
```

### Qué se espera

Mariano estimó "no asumir 1s por SKU". Medición esperada rough-order-of-magnitude:
- 1 SKU: < 100 ms (red + auth + response SL).
- 20 SKUs batch: 150-300 ms (serialización $filter + response más gordo).
- 80 SKUs batch: < 1 s si el SL lo acepta sin truncar.

**Si el filtro excede 2 KB (típico límite URI)** → split en bloques de ~50 SKUs (asumiendo SKU avg 12 chars + " or ItemCode eq " overhead → ~30 chars/sku → 50 SKUs = ~1.5 KB).

### Entregable antes de autorización

Correr el script contra prod y pegar en este doc los resultados reales:

```
TODO (pending autorización + ejecución): completar con output empírico.
Formato esperado:

| N SKUs | Median (ms) | P95 (ms) | P99 (ms) | Status | Body size |
|---|---|---|---|---|---|
| 1   |   |   |   |   |   |
| 20  |   |   |   |   |   |
| 50  |   |   |   |   |   |
| 80  |   |   |   |   |   |
| 150 |   |   |   |   |   |

¿Cuántos SKUs entran en un filter $filter < 2048 chars?
¿SL devuelve HTTP 414 o 400 cuando se excede? ¿O trunca silencioso?
```

**Si p95 de 50 SKUs > 1500 ms** → el timeout 3s del commit lo partiría; replan.
**Si p95 de 50 SKUs < 500 ms** → podemos ir con bloques de 50 cómodos.

---

## 5. Costo mensual estimado

### Capa 1 — Cloud Scheduler + CF scheduled

- **Cloud Scheduler**: 3 jobs gratis por mes por proyecto (actualmente usamos 0). El job `syncSapCatalogStockCF` entra en el free tier.
- **CF scheduled Node 22 Gen 2**:
  - 288 corridas/día × 30 días = 8640 corridas/mes.
  - Duración media esperada: 10-15 segundos (basado en el actual sync Python).
  - CPU alloc: `256 MiB` + `0.167 vCPU` por default.
  - Memoria: 256 MiB.
  - Costos (precios SOEA1):
    - Invocations: 8640 × $0.40 / 1M = **$0.003 / mes** (negligible).
    - CPU-seconds: 8640 × 15s × 0.167 vCPU-s = 21,654 vCPU-s × $0.0000024 ~= **$0.05 / mes**.
    - Memory-seconds: 8640 × 15s × 256 MiB-s = 33 M MiB-s × $0.0000025 / MiB-s ~= **$0.08 / mes**.
    - Networking out: Response del SL (~5-10 MB por sync) × 288/día × 30 = ~45 GB egress → sobre el free tier 1 GB/mes = **~$5 / mes** si Firestore writes salen a internet (improbable, es intra-GCP). Para intra-region/intra-project egress es $0.
  - **Total Capa 1 estimado**: < $0.50 / mes. Dentro del free tier esencialmente.

### Capa 2 — Live query SL por CF callable

- **Volumen**: Mariano estimó 100-200 queries/día. Asumiendo pico 300/día:
  - 300 × 30 = 9000 invocaciones/mes.
  - CPU-s: 9000 × 0.5s × 0.167 vCPU-s = 751 vCPU-s = **$0.002 / mes**.
  - Memory-s: 9000 × 0.5s × 256 MiB-s = 1.15 M MiB-s = **$0.003 / mes**.
  - **Total Capa 2 estimado**: < $0.10 / mes.

### Capa 3 — Cambio de constante, cero costo.

### Total mensual estimado Fase 3: **< $1 USD** sobre lo que ya paga el proyecto.

---

## 6. Carga sobre SAP

### Capa 1 — Sync cada 5 min

- Hoy sync Python corre ~2-5 h → 5-12 corridas/día.
- Capa 1 → 288 corridas/día.
- Por corrida: ~300 llamadas al SL (paginación Items con limit=20 default) + login + logout.
- Total/día: 288 × 300 ≈ 86,400 llamadas SL/día post-rollout.
- Vs hoy: 10 × 300 = 3,000 llamadas SL/día.
- **Factor 28×**. SAP es nuestro con licencia; sin cobro por llamada. SL tiene cupo de sesiones concurrentes (ver §Sesiones) + CPU del server B1 host.

### Mitigación del factor 28×

- **Session pool**: cada corrida reutiliza una sesión si está viva (no re-logineamos). Reduce overhead login/logout de 300 → 1.
- **Delta sync (opcional, no en scope F3)**: si el server B1 host sufre, agregar filtro `$filter=UpdateDate ge <lastSync>` para solo items modificados. Hoy el sync es "full snapshot". Delta sync bajaría llamadas por corrida de 300 a < 30. Decisión para Mariano: ¿scope F3 o F4?
- **Monitoring**: contar llamadas en `operations_log._syncRun.slRequests` y revisar al día 2 del rollout. Si David (admin SAP) reporta carga visible → activar delta.

### Capa 2 — Live queries

- 300 queries/día × 1 llamada batch cada una = 300 llamadas extras/día. Negligible contra 86,400 del sync.

### Conclusión carga

Con session pool N=2 + sync cada 5 min + sin delta sync: **86,700 llamadas SL/día**. Factor 28× sobre hoy. Observar en rollout. Si problemático → delta sync F4.

---

## 7. Lista de tests

### Capa 1

**Unit** (`tests/functions/sync-sap-catalog-stock-core.test.js`):
- T1 — login OK → extrae cookie B1SESSION.
- T2 — login 401 → reintenta 1× con backoff.
- T3 — login HTTP 400 "-7" (cupo excedido) → espera 5s + reintenta.
- T4 — paginación: 3 páginas de 20 → total 60 Items.
- T5 — item con warehouse 05/06 → se excluyen de quantities pero whs breakdown los incluye.
- T6 — `_syncRun` entry escrito con startedAt/finishedAt/durationMs/itemsSynced/errors.
- T7 — snapshot.source = 'cf-scheduled' al escribir.
- T8 — concurrent runs: 2 corridas en paralelo → session pool las serializa.
- T9 — SL caído completo → sync falla, `_syncRun.errors` populated, snapshot NO se actualiza.

**Mirror sync** (`tests/unit/audit/sync-sap-catalog-stock-vs-python.test.js`):
- Comparar lógica de cálculo del CF Node vs Python actual con fixtures idénticos.

**Session pool** (`tests/functions/sap-sl-session-pool.test.js`):
- 10 llamadas concurrentes con N=2 → mutex se respeta, nunca > 2 sesiones vivas.
- Session expira a 25 min idle → re-login al próximo use.
- SL devuelve 401 → session se descarta + re-login en siguiente use.

**Alerting** (`tests/functions/stock-sync-stale-alert.test.js`):
- Última corrida > 15 min → doc `alerts/stock_sync_stale` creado.
- Última corrida < 15 min → doc NO creado.

### Capa 2

**Live query batch** (`tests/functions/fetch-stock-live-core.test.js`):
- T1 — 1 SKU → 1 request.
- T2 — 60 SKUs → 2 requests (bloques de 50).
- T3 — todos OK → ok=true, fisicoDep11 populado, snapshotFallback=false.
- T4 — SL caído → ok=true, snapshotFallback=true, fisicoDep11 del snapshot, snapshotAgeMs populado.
- T5 — timeout 3s → ok=true, modo partial: solo líneas en riesgo + log operations_log.
- T6 — Snapshot vencido + SL caído → DENTRO de `commitPedidoCF` throw `SAP_UNAVAILABLE`.

**Mirror sync** (`tests/unit/audit/stock-breakdown-fisico-override-sync.test.js`):
- `src/pure/stock-breakdown.js` y `functions/core/pedido-snapshot-core.js` ambos aceptan `fisicoDep11Override` + usan el mismo valor.

**Integration commitPedidoCF** (`tests/functions/commit-pedido-live-sl.test.js`):
- T1 — SL devuelve fisico=5 y snapshot=3 → CF usa fisico=5 → commit OK con 5u confirmed.
- T2 — SL caído + snapshot fresco (<30 min) → CF usa snapshot + log validated_with_snapshot.
- T3 — SL caído + snapshot vencido (>30 min) → `SAP_UNAVAILABLE`.
- T4 — SL devuelve menos stock que el snapshot (otro vendedor confirmó) → STOCK_CHANGED con `source='live_sl'` en el log.

### Capa 3

**Threshold** (`tests/functions/commit-pedido-snapshot-too-old.test.js`):
- Actualizar T5 y T6 para threshold 30 min (en lugar de 8h).

**Badge** (`tests/unit/sap-health-badge.test.js`):
- `< 10 min` fresh. `10-30 min` stale. `>= 30 min` muy stale.

**Suite completa esperada post-Fase 3**: unit ~1740 PASS + functions ~660 PASS.

---

## 8. Plan de deploy por capa

Cada capa es un PR separado. **No merge de la siguiente hasta estabilidad de la anterior**.

### PR 1 — Capa 1 (sync CF scheduled)

**Scope**: nueva CF + session pool + logging + alerting + script de medición.

**Pasos**:
1. **Paso 0 — Medir latencia SL** (sin tocar app):
   - Correr `scripts/perf/sl_batch_latency.py` contra prod.
   - Pegar resultados en §4 de este doc.
   - Autorización explícita de Mariano para avanzar.
2. **Paso 1 — Scaffolding CF** (sin deploy):
   - Crear `functions/core/sync-sap-catalog-stock-core.js` port de Python.
   - Crear `functions/core/sap-sl-session.js`.
   - Tests unit.
   - PR branch `feat-sync-cf-capa1` abierto, sin merge.
3. **Paso 2 — Deploy CF en paralelo con GHA**:
   - Merge PR → deploy automático.
   - CF scheduled cada 5 min + GHA cron cada 5 min siguen activos.
   - El campo `source` deja ver quién ganó cada corrida.
   - Monitoreo diario de `operations_log._syncRun` para huecos > 15 min.
4. **Paso 3 — Observación 2 días hábiles**:
   - Si CF cumplió 576 corridas sin hueco > 15 min → ir al paso 4.
   - Si hubo huecos: investigar causa (cold start, SL quota, red). Fixear. Repetir Paso 3.
5. **Paso 4 — Apagar GHA cron**:
   - PR mínimo que comenta el `schedule:` del workflow dejando solo `workflow_dispatch:`.
   - CLAUDE.md §60 actualizado para mencionar que la fuente de verdad es la CF.

**Rollback Capa 1**:
- Si CF está rota pero GHA sigue encendido → nada que revertir (GHA sigue cubriendo).
- Si CF está rota y GHA ya apagado → re-activar el `schedule:` del workflow + rollback de la CF (dejarla como `onCall` + manual trigger).

### PR 2 — Capa 2 (live SL en commit + modal)

**Scope**: nueva callable `fetchStockLiveCF` + modificación `commitPedidoCF` + wrapper cliente + badge UI.

**Pasos**:
1. **Pre-req**: Capa 1 observada estable 2 días hábiles.
2. **Paso 1 — Scaffolding**:
   - `functions/core/fetch-stock-live-core.js` (helper batch, timeout 3s).
   - `functions/index.js` export `fetchStockLiveCF`.
   - Modificar `commitPedidoCore.js:5.6` para llamar al helper antes del compute breakdown.
   - Modificar `src/pure/stock-breakdown.js` + mirror para aceptar `fisicoDep11Override`.
   - Modificar `index.html:_renderWaitlistCard` para hacer la callable antes del render + mostrar badge.
   - Tests.
3. **Paso 2 — Shadow mode**:
   - Deploy CF + cliente con flag `app_config/live_sl.enabled = false`. Lee el flag.
   - Si flag=false: el helper fallback a snapshot (comportamiento actual).
   - Si flag=true: usa live SL.
   - Habilitar flag solo para Mariano (whitelist uid en el helper) 48h.
4. **Paso 3 — Rollout gradual**:
   - Habilitar flag para 1 VDE (Gonzalo) + Pablo 24h.
   - Monitoreo: `operations_log` tipo `commit_pedido_validated_with_snapshot` y `stock_live_partial`.
   - Habilitar flag para resto del equipo si silencio.
5. **Paso 4 — Full on**:
   - Flag → true global.
   - Log operations_log con type='live_sl_enabled_global'.

**Rollback Capa 2**:
- Flag → false global. CF sigue existiendo pero no se usa.
- Si bug peor: revertir el commit del helper + redeploy `commitPedidoCF`.

### PR 3 — Capa 3 (threshold 30 min)

**Pre-req**: Capa 1 corriendo 7 días hábiles sin huecos > 15 min + Capa 2 flag=true global 7 días hábiles sin issues.

**Scope**: cambio de constante.

**Pasos**:
1. Bajar `SNAPSHOT_MAX_AGE_MS` a `30 * 60 * 1000`.
2. Ajustar badge SAP cliente a nuevos umbrales.
3. Deploy functions.
4. CLAUDE.md §60 actualizado con cierre + fecha.

**Rollback Capa 3**: subir constante a 8h (1 línea).

---

## 9. Compatibilidad hacia atrás

- **Capa 1**: la escritura al mismo doc preserva todos los lectores (cliente, otras CFs). Shape nuevo campo `source` + `_syncRun` opcionales (lectores existentes los ignoran).
- **Capa 2**: cliente que no cargue el bundle v1444+ sigue leyendo snapshot (no llama a `fetchStockLiveCF`). Compat total.
- **Capa 3**: solo endurece el umbral; clientes viejos siguen enviando lo mismo.

Service Worker invalida cache en cada bump: `v1444` para capa 1, `v1445` para capa 2.

---

## 10. Preguntas abiertas para Mariano

1. **¿Delta sync opcional en F3 o F4?** — Factor 28× de carga SL no bloquea pero conviene conocer la posición de David. Default propuesto: F4.
2. **Session pool size** — ¿Mantener `N=2` o subir a `N=3` desde el día 1 por margen? Default: 2.
3. **Qué email para alerta de stock_sync_stale** — ¿Mariano + Pablo? ¿Solo Mariano?
4. **Live query en más pantallas** — ¿Extender a popup Stock del SKU (Master de productos)? Default: NO en F3; abrir F3.1 si tiene valor.
5. **Timeout 3s por pedido vs por batch** — Confirmado: por pedido total. Si N=80 SKUs y p95 de un batch es 500 ms, 2 batches = 1 s. Queda margen 2 s para parsing + logging.

---

## 11. Diferencias con el prompt original

Ninguna. Las 3 decisiones Mariano del prompt previo quedan intactas:
- Rollout 2 días paralelo con `source` field.
- Live SL batch, timeout 3s total, fallback líneas en riesgo + snapshot.
- Fallback SL caído = snapshot fresco OK, snapshot vencido = SAP_UNAVAILABLE.

---

## 12. Qué espero del siguiente turno

**Mariano revisa** este doc y responde con **autorización explícita** por capa (o pedidos de cambio sobre este doc). Al autorizar Capa 1:

1. Primero: `scripts/perf/sl_batch_latency.py` corrido + resultados pegados en §4.
2. Mariano decide si avanzar basado en los números.
3. Si verde: PR 1 implementación.

**Hasta entonces**: nada tocado en código. Logging §64 corriendo en prod; el martes se audita con script V.
