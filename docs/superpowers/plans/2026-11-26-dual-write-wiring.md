# Plan — Wiring dual-write Firestore → PG en commitPedidoCore (Stack S-12)

**Fecha**: 2026-11-26
**Rama**: `feat/s12-dual-write-wiring`
**Autor**: tdd-orchestrator (sub-agent)
**Status**: Draft — wiring detrás de flag `dual_write_pedidos_enabled` default `OFF`. **Nada se activa en producción al mergear.**

---

## Contexto

El PR S-10 ya mergeó a `main`:

- `src/pure/dual-write/transform-pedido-to-pg.js` + mirror `functions/core/dual-write/transform-pedido-to-pg.js` (§57).
- `src/pure/dual-write/compare-pedido-parity.js` + mirror (§57).
- Schema PG v0 aplicado a `crm-staging` (`backend-new/db/schema/0001_initial.sql`).
- Backend TS en `backend-new/` (API Hono + Kysely).

Plan S-10 original (`2026-11-26-dual-write-pedidos.md`) describe trigger `onDocumentWritten` separado. S-12 elige un **enfoque más simple**: wiring inline post-commit dentro del propio core `commitPedidoCore`. Beneficios:

- 1 sola CF en el call graph (sin trigger extra = sin cold start adicional).
- Idempotencia natural por `pedidoId` (el core ya lo tiene en la mano).
- Latencia mínima entre Firestore commit y PG write (no espera al dispatch del trigger).

Trade-off: `commit-pedido-core.js` gana una dep nueva. La aisló en `functions/core/dual-write-pg.js` con interfaz chica (`replicatePedidoToPg(deps, pedidoId, pedidoDoc)`).

---

## Objetivo

Wiring que replica cada commit exitoso de `commitPedidoCore` a Postgres cuando `dual_write_pedidos_enabled === true`. Fire-and-forget: Firestore es fuente de verdad; PG es espejo secundario. Si PG falla, encolar en `dual_write_pending` para reintento manual sin romper el commit.

**Requisitos** (del prompt S-12):

1. Firestore sigue siendo la fuente de verdad. PG es secundario.
2. Si PG falla, NUNCA romper ni demorar el commit. Fire-and-forget + enqueue retry.
3. Idempotente por `pedidoId`: delete-then-insert atómico dentro de una tx PG.
4. Cubre alta + modificación + cancelación de pedido (toda mutación persistida).
5. Flag OFF por default en prod. Lee `app_config/feature_flags.dual_write_pedidos_enabled`.
6. Idempotencia también en reintentos (el retry worker re-ejecuta sin corromper).

---

## Decisión A/B/C

**Elijo C** (helper puro `src/pure/dual-write-pg-helpers.js` + módulo server `functions/core/dual-write-pg.js` con `pg` Pool directo + SQL inline).

Detalle: ver `docs/adr/0016-dual-write-wiring.md`.

Rechazadas:

- **A** (import directo `backend-new/` TS): Firebase Functions v6 soporta TS pero no mezcla directa con ESM del root `functions/`. Requeriría build pipeline nuevo — fuera de scope de S-12.
- **B** (lógica duplicada en `functions/core/`): rompe el patrón `src/pure/` + mirror (§57) del resto del repo.

C respeta el patrón, permite tests unit con mock pg, y reusa los helpers existentes (`transformPedidoToPg`, `comparePedidoParity`) sin tocarlos.

---

## Arquitectura

```
commitPedidoCore (post-commit Firestore OK)
    │
    ├─ si flag OFF → no-op (return)
    │
    └─ si flag ON:
         │
         ├─ fire-and-forget: replicatePedidoToPg(deps, pedidoId, pedidoDoc)
         │       │
         │       ├─ transformPedidoToPg (pure, reusado)
         │       │
         │       ├─ pg.Pool.query (BEGIN; DELETE pedidos WHERE id=$1 CASCADE;
         │       │                 INSERT pedido; INSERT lines[]; (reservations
         │       │                 las crea el trigger PG t_sync_stock_reservations); COMMIT)
         │       │
         │       ├─ si OK: log 'dual_write_ok'
         │       │
         │       └─ si falla: 
         │              - fbDb.collection('dual_write_pending').doc(pedidoId).set({
         │                    pedidoId, failedAt, errorMessage, attempts, lastPayloadDocExists:true
         │                })
         │              - log 'dual_write_failed'
         │              - NO throw (fire-and-forget)
         │
         └─ (commit response al cliente ya fue despachado)
```

**Deps inyectadas**: `deps.pgPool` (opcional, singleton de `pg.Pool`), `deps.featureFlagsDoc` (resolver del flag), `deps.log`.

Si `deps.pgPool` NO está presente (ambientes sin PG configurado, tests, prod inicial), la replicación se skipea con log `dual_write_skipped_no_pool` — fail-open.

---

## Impacto en `commit-pedido-core.js`

- 2 call sites nuevos del helper:
  1. **Idempotent hit** (línea ~245) → replicar el `existingPedido.data` que ya se leyó.
  2. **Success post-tx** (línea ~760) → replicar `pedidoRef.data` (releer desde Firestore post-commit, o reconstruir desde `payload.lines` + `lineasResultado`).

- Ambos son `.catch(e => log('dual_write_fire_forget_err', {err:e.message}))` — nunca propagan.

- Nueva dep en `functions/package.json`: `pg@^8.13.0`.

---

## Shape `dual_write_pending` (nueva colección Firestore)

```js
{
  pedidoId: 'p_abc123',          // doc id = pedidoId para dedupe natural
  failedAt: Timestamp,
  firstFailedAt: Timestamp,      // no se sobrescribe en reintentos sucesivos
  errorMessage: 'connection refused 127.0.0.1:5433',
  errorCode: 'ECONNREFUSED' | null,
  attempts: 1,
  lastAttemptAt: Timestamp,
  resolvedAt: Timestamp | null,  // null hasta que un worker lo marque OK
}
```

**Rules**: `allow read, write: if false` (solo admin SDK). El CF escribe con `set(..., {merge:true})`.

---

## TDD plan

### Fase RED (tests failing)

1. `tests/functions/dual-write-commit-pedido.test.js` (unit, mock PG en memoria):
   - T1: flag OFF → no-op (no se llama `pgPool.query`).
   - T2: flag ON + commit exitoso → `pgPool.query` se llama con BEGIN/INSERT/COMMIT.
   - T3: flag ON + PG lanza error → enqueue en `dual_write_pending` + no throw.
   - T4: flag ON + replicación corrida 2 veces mismo pedidoId → idempotente (segunda llamada hace DELETE primero, luego INSERT limpio).
   - T5: flag ON pero `deps.pgPool` undefined → log `skipped_no_pool` sin throw.
   - T6: cancelación (líneas con `state='cancelled' + qtyOpen=0`) se replica sin violar trigger reservations invariant.

2. `backend-new/db/tests/dual-write-integration.test.js` (integration contra staging):
   - T1: happy path alta pedido con 2 líneas ASIG → verifica `pedidos`, `pedido_lines`, `stock_reservations`.
   - T2: modificar el mismo pedido (línea 1 pasa a confirmed) → replicación update refleja el cambio.
   - T3: cancelación completa del pedido (todas las líneas cancelled) → `stock_reservations` queda vacío.
   - T4: reintento idempotente sobre pedido ya replicado → mismo resultado (sin duplicados).

### Fase GREEN (implementación mínima)

- `functions/core/dual-write-pg.js` con `replicatePedidoToPg(deps, pedidoId, pedidoDoc)` + helper `buildInsertStatements(result)` que arma SQL + params desde el output de `transformPedidoToPg`.
- `src/pure/dual-write-pg-helpers.js` con las funciones puras de SQL building (nombre tabla, conflict resolution, orden canónico de columnas).
- Wiring en `commit-pedido-core.js`:
  - Agregar lectura de flag al principio (ya tenemos pattern en §108).
  - Agregar 2 call sites fire-and-forget.
- Agregar `pg@^8.13.0` a `functions/package.json`.

### Fase REFACTOR

- Mover la lectura del flag a un helper compartido si aparece boilerplate.
- Verificar que todos los tests de `commit-pedido-core` siguen pasando con el flag OFF (default).

---

## Gates ejecutables

### Tests unit

```bash
cd "C:/Users/shimano.sandbox/Desktop/tmp-dual-write"
npm run test:unit -- tests/functions/dual-write-commit-pedido.test.js
```

Esperado: 6/6 PASS.

### Tests integration

```bash
cd "C:/Users/shimano.sandbox/Desktop/tmp-dual-write/backend-new"
DATABASE_URL="postgresql://crm_app:$PG_PASSWORD@127.0.0.1:5433/crm" \
  npx vitest run db/tests/dual-write-integration.test.js
```

Esperado: 4/4 PASS (con proxy 127.0.0.1:5433 vivo).

### Suite completa (sin romper nada)

```bash
cd "C:/Users/shimano.sandbox/Desktop/tmp-dual-write"
npm run test:unit
```

Esperado: todo PASS (el wiring con flag OFF no cambia comportamiento).

---

## Rollback plan

Si el feature falla en prod:

1. **Soft**: flag OFF en `app_config/feature_flags.dual_write_pedidos_enabled` — basta con 1 write Firestore.
2. **Hard**: revert del commit del wiring en `functions/core/commit-pedido-core.js`. `dual-write-pg.js` queda huérfano pero sin consumidores (no rompe).

Garantía: con flag OFF no hay path que toque PG — Firestore es la fuente de verdad intacta.

---

## Consideraciones S-3 adversarial

El PR va a pasar por `pr-review-toolkit:silent-failure-hunter`. Mitigo:

- Fire-and-forget con `.catch(e => deps.log('dual_write_fire_forget_err', {err:e.message}))` — logueado con nombre descriptivo (no catch mudo).
- Los tests cubren el escenario PG caído + propagan que el commit sigue OK.
- Logs explícitos: `dual_write_ok`, `dual_write_failed`, `dual_write_skipped_flag_off`, `dual_write_skipped_no_pool`.
- `dual_write_pending` entry escrita con `.set({merge:true})` incrementando `attempts` — no silencia errores repetidos.
- Flag lectura fail-closed: si `getFeatureFlagsDoc()` falla, asumo OFF (nunca escribir a PG sin autorización).
