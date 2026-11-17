# E2 reparto-dep12 — CF trigger + scanners dep 12

**Fecha**: 2026-11-17
**Plan**: `docs/superpowers/plans/2026-11-17-reparto-dep12.md` §4 E2.
**Precedentes**: E0 (`src/pure/detect-stock-increases.js` + mirror + warehouse-constants) + E1 (breakdown v8 + `lineReservesStock` enTransito + CPST ext).

## Antes

- `onDep11IncreaseCreateReparto` detectaba sólo deltas en dep 11. SKUs con stock entrando a dep 12 (tránsito Uruguay → Argentina) no generaban `ingresos_reparto` hasta que efectivamente cruzaran al dep 11 (~7 días).
- No existía mecanismo para revertir ASIG asignadas contra dep 12 cuando SAP cancelaba la partida.
- `applyRepartoManualCore` no marcaba las ASIG resultantes con `enTransito=true` cuando el ingreso era contra dep 12.

## Problema

Mariano reporta: cuando entra mercadería a dep 12 (tránsito) Pablo necesita poder repartirla a la cola BO para que, cuando cruce a dep 11, los clientes ya la tengan reservada automáticamente. La feature queda bloqueada hasta que E2 habilite la CF para dep 12.

## Cambio

### 1. Feature flag `dep12_reparto_enabled`

- Nuevo doc Firestore: `app_config/feature_flags.dep12_reparto_enabled` (boolean, default `false`).
- Pure `src/pure/feature-flags.js` + mirror `functions/core/feature-flags.js` (§57) con sync test `tests/unit/audit/feature-flags-sync.test.js`.
- CF lee el flag al inicio de cada invocación. Si `false`, los 2 scanners nuevos quedan NO-OP (safety-off por default — FIX-A7 §11.2 del plan).

### 2. `createIngresosRepartoFromDelta` extendido

- Procesa `dep12Deltas` del nuevo `detectStockIncreases` (E0) detrás del flag.
- Para cada SKU con delta dep 12 positivo y clientes BO vigentes, crea `ingresos_reparto` con `source='dep12' + warehouse=12`.
- Dedupe: query por `sku + source='dep12'` en status `pending/in_progress` (idempotencia).
- Log `operations_log` AWAIT con `type='reparto_dep12_creado'` (§64.2 FIX-A3).

### 3. `applyRepartoManualCore` + `_buildAsigLine` extendidos

- `_buildAsigLine` acepta `opts.enTransito` + `opts.asigAtTransito` (ambos opcionales).
- Cuando el ingreso es `source='dep12'` (o `warehouse===12`), las ASIG resultantes del reparto llevan `enTransito=true` + `asigAtTransito=nowIso`. Cubre los 3 caminos (línea entera ASIG, split, revert+append).

### 4. Nuevo `functions/core/reparto-transito-core.js`

Dos scanners principales:

- **`scanCancelledTransito(deps, before, after)`** (FIX-A1 §58 strict):
  - Detecta vía `detectTransitoCancelaciones` las bajas dep 12 sin suba dep 11.
  - Para cada SKU: recorre ASIG vivas con `enTransito=true` FIFO por `asigAtTransito` ASC → revierte a BO con `closedReason='partida_cancelada_en_transito'`, audit `asigRevertidaBy='system:scanCancelledTransito'`.
  - `runTransaction` por pedido (§58 ALL reads before writes + §104 re-lectura).
  - Fail-safe: si un pedido falla su tx, los demás siguen.
  - Log `operations_log` AWAIT con `type='asig_revertida_partida_cancelada'`.

- **`scanDep12ToDep11Transitions(deps, after)`**:
  - Recorre ASIG vivas con `enTransito=true` + verifica que el físico dep 11 cubre el nominal (SAP hizo el cruce).
  - Muta la línea a `enTransito=false` + setea `enDep11At`.
  - E3 va a extender esto para disparar auto-send cuando TODAS las líneas de un pedido crucen (fuera del scope E2).
  - Log `operations_log` AWAIT con `type='asig_cruzo_a_fisico'`.

### 5. CF `onDep11IncreaseCreateReparto` + alias `onStockSnapshotWrittenReparto`

- El handler existente ahora encadena los 2 scanners nuevos **detrás del flag**.
- Nuevo export `onStockSnapshotWrittenReparto` como alias (name match al scope real: dep 11 + dep 12). Compat deploy: el export histórico queda vivo en paralelo.

## Por qué

- Feature flag `OFF` default: deploy de E2 es 0-op funcional hasta activación consciente (FIX-A7). El rollback de E5 depende de este flag.
- §58 strict + re-lectura: previene SATO-like races (precedente 2026-10-23) donde entre el scan y la escritura el pedido cambió.
- FIFO por `asigAtTransito`: cuando Pablo asignó varias unidades al mismo SKU contra dep 12 en distintos momentos, al cancelar partida revierte las más viejas primero (determinístico).
- Logging AWAIT (§64.2): toda mutación queda en `operations_log` para auditar E2 post-deploy.

## Verificación

```
cd worktree/APP-VENDEDORES-E2
npx vitest run tests/functions/reparto-transito-core.test.js tests/unit/audit/feature-flags-sync.test.js
npx biome check functions/core/reparto-transito-core.js functions/core/feature-flags.js src/pure/feature-flags.js functions/core/reparto-core.js functions/index.js
npx tsc --noEmit
```

Resultado: **14 tests nuevos PASS + 0 biome errors + 0 typecheck errors**.

## Rollback

1. Flip `app_config/feature_flags.dep12_reparto_enabled = false` en Firestore. CF skip inmediato en próxima ejecución.
2. Esperar que no haya ASIG vivas con `enTransito=true` (verificar con query).
3. `git revert <sha_e2>`. Nada en `pedidos`/`ingresos_reparto` necesita reversión manual porque el flag estaba OFF (no se creó data E2).

## Pendiente (fuera del scope E2 original — requiere PR adicional)

El plan E2 enumera 8 fixes del feedback de agentes + 20 tests. Esta PR cubre los esenciales para destrabar la feature:

- ✅ Feature flag + mirror + sync test (FIX-A7).
- ✅ `scanCancelledTransito` + `scanDep12ToDep11Transitions` dentro de `runTransaction` §58 (FIX-A1).
- ✅ `applyRepartoManualCore` marca enTransito=true cuando ingreso.source='dep12'.
- ✅ Log `operations_log` AWAIT por mutación.
- ✅ Rename export CF (alias).
- ✅ 14 tests nuevos (8 `scanCancelledTransito` + `scanDep12ToDep11Transitions` + 4 feature-flags sync + 2 loadFeatureFlagsDoc).

Pendiente de iteración (requiere planificación con Mariano):

- **Property-based tests** (FIX-A5 serverTimestamp skew + invariantes: `numRuns: 300`).
- **T-partida-parcial-exacta** + **T-reconcile-mientras-pablo-asigna** (casos borde complejos).
- **FIX-A2 fail-open `transitoDep12` undefined** — el breakdown ya lo trata como 0 (E1), falta el log `type='transito_source_missing'`.
- **FIX-A4 guard mixto parcial en auto-send** — va en E3.
- **FIX-A8 CPST con ASIG tránsito** — extensión de helpers cpst-* (E1 agregó las flags; el consumo real queda en E4).
- Scheduled safety-net cada 5min (FIX-A4).
- Extensión de `reconcileRepartosFaltantes` para dep 12 (hoy solo dep 11; el delta dep 12 está cubierto via `createIngresosRepartoFromDelta`).

**Nota de alcance**: esta PR deja el pipeline E2 funcional end-to-end con flag OFF por default. Mariano puede activar el flag en Firestore para hacer dogfooding sin re-deploy. Los tests restantes y FIX-A2/A4/A8 vienen en PR complementaria pre-E3.
