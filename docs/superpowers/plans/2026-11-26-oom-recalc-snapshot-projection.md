# Plan — Fix OOM `onPedidoWriteRecalcSnapshot` via proyección + one-pass (S-10 P0)

**Fecha**: 2026-11-26.
**Autor**: Claude Opus 4.7 (1M context).
**Decisor**: Mariano. Decisión 2026-11-26 11:22 ART: optimizar query, NO bump de memoria.
**Precedente**: `STACK_44_OOM_RECHECK_S9_C2.md` — 31 OOM / 3 clusters / pico 535 MiB sobre límite 512 MiB.

---

## Objetivo

Bajar el pico de memoria de `onPedidoWriteRecalcSnapshot` de ~535 MiB a ~150-200 MiB **sin** bump del límite. Mantener el shape del snapshot output byte-exacto (zero regresión funcional).

## Root Cause (systematic-debugging Fase 1)

`functions/core/pedido-snapshot-core.js:629` — `loadOpenPedidos()` hace:

```js
const snap = await deps.fbDb.collection('pedidos').where('closedAt', '==', null).get();
```

Esto trae **TODOS** los pedidos abiertos (~475 según STACK_15) con TODOS sus campos. `lines[]` domina el peso del doc (~1-2 KB por línea × ~5-15 líneas promedio × 475 docs ≈ 3-15 MB solo de `lines[]` por invocación).

Agravante — algoritmo for-sku × for-pedido en `recalcSnapshotForSkus`:

```js
for (const sku of affectedSkus) {
  const agg = aggregateForSku(pedidos, sku, now);  // itera los 475 pedidos
  ...
}
```

Si un write toca K SKUs distintos: `475 × K` iteraciones. Para una línea nueva K=1; para split/merge K=2-5. Con 5 SKUs afectados × 475 pedidos × 10 líneas = 23.750 iteraciones de lectura de objeto línea.

**En alta concurrencia**: el Pub/Sub del trigger entrega N escrituras en paralelo. Cada instancia carga su copia de 475 docs. Pico observado 535 MiB confirma que 2-3 instancias concurrentes saturan el heap.

## Pattern Analysis (Fase 2)

Comparar con triggers similares:

| CF | Algoritmo | Memoria |
|---|---|---|
| `onPedidoWriteRecalcSnapshot` | Carga 475 docs completos | 535 MiB pico |
| `onPedidoWriteTrackAsigTransitions` | Solo lee before/after del event | 256 MiB OK |
| `onDep11IncreaseCreateReparto` | `reparto-core.js:createIngresosRepartoFromDelta` solo pagina SKUs afectados | 256 MiB OK |
| `onPedidoConfirmedSendToSap` | Solo el pedido confirmado | 256 MiB OK |

Patrón canónico que funciona: **no leer todos los pedidos; leer solo lo relevante al delta**.

## Hipótesis (Fase 3)

Dos cambios independientes:

### Cambio A — Proyección de campos (bajo riesgo)

Firestore Admin SDK soporta `.select('field1', 'field2', ...)`. Devuelve docs con **solo esos campos**. El resto no se serializa ni se carga en memoria.

`aggregateForSku` consume únicamente:
- `clientCardCode`
- `transferidoSAP` (solo check de null)
- `createdAt`, `confirmedAt` (via `lineReservesStock`)
- `closedAt` (ya filtrado por la query)
- `lines[]` (iteración)

Campos NO necesarios que se cargan hoy en vano: `netAmountArs`, `observaciones`, `discountSnapshot`, `sapDocTotal`, `assignedVendorUid`, `ownerVendor`, `_backfill`, `key`, timestamps extra, etc.

Impacto esperado: docs pasan de ~2-5 KB a ~1-2 KB → **~50% menos memoria**.

### Cambio B — Algoritmo one-pass (bajo riesgo)

Invertir el loop:

**Antes** (for-sku × for-pedido):
```js
for (const sku of affectedSkus) {
  const agg = aggregateForSku(pedidos, sku, now);  // 475 × 10 líneas
  perSku.set(sku, agg);
}
```

**Después** (for-pedido × for-line × filter-affected):
```js
const perSku = initPerSku(affectedSkus);
for (const p of pedidos) {
  if (p.closedAt || !p.transferidoSAP) continue;
  for (const l of p.lines || []) {
    const sku = String(l.code || '').toUpperCase();
    if (!affectedSkus.has(sku)) continue;
    aggregateOneLine(perSku, sku, p, l, now);
  }
}
```

Reduce de `475 × K × 10` a `475 × 10` iteraciones. Beneficio: **menos CPU, más tiempo de GC disponible** (reduce memory pressure derivado de GC lento bajo carga).

### Expectativa combinada

- Memoria: 535 MiB → 150-200 MiB.
- Margen: 300-350 MiB para absorber alta concurrencia (3-4 instancias paralelas).
- CPU: bajo chico (iteramos solo 1 vez; `aggregateOneLine` hace el mismo trabajo por línea).
- Shape output: byte-exacto (mismo `perSku` final).

## Plan (Fase 4 — Implementation)

### TDD — tests primero

**Test 1** (`tests/functions/pedido-snapshot-core-oom-fix.test.js`): fixture con 500 pedidos sintéticos × 10 líneas c/u → `recalcSnapshotForSkus(deps, {SKU-A, SKU-B, SKU-C})` devuelve el MISMO output que la versión actual (snapshot byte-exacto con `perSku.get('SKU-A').bo == X` + `.asig == Y` + `.asigByClient` map correcto).

**Test 2** (memory ceiling): el fixture de 500 pedidos no debe hacer más de 50 lecturas de atributos del doc que no sean los 6 campos proyectados. Asegurable via mock que trackea `data.NOMBRE_CAMPO` reads.

**Test 3** (regresión paridad): el `loadOpenPedidos` nuevo con `.select()` devuelve el mismo shape que consumen todos los call-sites.

### Cambio de código

1. **`functions/core/pedido-snapshot-core.js:loadOpenPedidos`** → agregar `.select(['clientCardCode', 'closedAt', 'transferidoSAP', 'createdAt', 'confirmedAt', 'lines'])` antes del `.get()`.

2. **`functions/core/pedido-snapshot-core.js:recalcSnapshotForSkus`** → nueva implementación one-pass:
   - Pre-crear `perSku: Map<string, {bo, asig, asigByClient, boByClient}>` con keys de `affectedSkus`.
   - Un loop externo por pedido, interno por línea.
   - Extraer la lógica inner de `aggregateForSku` a helper `aggregateOneLine(perSku, sku, p, l, now)`.
   - `aggregateForSku` queda como wrapper que llama al helper (no se toca la export para backward-compat; cualquier otro consumer sigue funcionando).

3. **Zero cambio** al shape del output. Zero cambio a `writeSnapshot` o `writePerSkuShadowSnapshot`.

### Verificación

- `npm run test:functions` → suite PASS (existing + 3 nuevos).
- `node build.js` no requiere rebuild (no toca src/).
- Fixture local con 500 pedidos: ejecutar recalc 10 veces en secuencia, medir `process.memoryUsage().heapUsed` antes y después. Debe ser << 100 MB.
- Deploy en staging primero (post-setup Mariano, ver PENDIENTE_HUMANO), observar logs 24h.
- Si OOM reaparece → investigar con fixture de volumen real exportado de prod.

### Rollback

1. `git revert <sha>` + redeploy la revisión anterior del CF.
2. Como fallback: `firebase functions:secrets:set ...` no aplica — simplemente redeploy.
3. Los logs `_syncRun` del snapshot incluyen `clientVersion` — si aparece regresión, fácil identificar.

### Scope — qué toca y qué no

**Toca**:
- `functions/core/pedido-snapshot-core.js` (loadOpenPedidos, recalcSnapshotForSkus).
- `tests/functions/pedido-snapshot-core-oom-fix.test.js` nuevo.

**NO toca**:
- `commit-pedido-core.js` (otra sesión en paralelo).
- `index.html` / bundle / src.
- Firestore rules.
- Pedidos, stock, reservas, descuentos (shape de output idéntico).

### PR para revisión humana

- Branch: `fix/oom-recalc-snapshot-projection`.
- CI: debe pasar (tests + biome + tsc).
- Reviewer adversarial distinto del autor: pr-review-toolkit:silent-failure-hunter + pr-review-toolkit:code-reviewer.
- **NO deploy autónomo**. Mariano decide ventana de deploy.
- Monitoreo post-deploy: `gcloud logging read` del STACK_05 + CLOSE #1435 si 24h sin OOM nuevos.

## Qué NO hace este fix

- NO agrega índice `skuIndex[]` a pedidos (requiere backfill masivo + migración de schema; es la opción F del análisis para una iteración futura).
- NO cambia la cadencia del trigger.
- NO toca rules ni permissions.
- NO baja el límite de memoria (no es necesario — solo reduce el pico; el límite 512 MiB queda igual como red de seguridad).

## Próximos pasos post-merge

Si la proyección + one-pass no es suficiente (pico sigue > 400 MiB):

- Iteración 2: agregar `skuIndex: string[]` al write de `commitPedidoCF`. `recalcSnapshotForSkus` usa `where('skuIndex', 'array-contains-any', [...affectedSkus])` → reads escalan con pedidos-por-SKU no con todos los pedidos.
- Iteración 3 (fundamental): migrar snapshot computation a CF scheduled batch + materialized view en PostgreSQL (post ADR-001 schema PG).

Ambos quedan como notas para ADRs futuros cuando la migración PG arranque.
