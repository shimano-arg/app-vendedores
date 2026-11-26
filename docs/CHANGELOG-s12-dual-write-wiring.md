# CHANGELOG — Stack S-12 Phase 2 Dual-Write Wiring

**Fecha**: 2026-11-26
**PR**: `feat/s12-dual-write-wiring`
**ADR**: `docs/adr/0016-dual-write-wiring.md`
**Plan**: `docs/superpowers/plans/2026-11-26-dual-write-wiring.md`

## Antes

- `commitPedidoCore` escribía exclusivamente a Firestore. El wrapper CF `onDocumentWritten` propuesto en plan S-10 (`2026-11-26-dual-write-pedidos.md`) nunca se habilitó.
- `backend-new/db/schema/0001_initial.sql` aplicado a `crm-staging` pero sin consumidores.
- `transformPedidoToPg` + `comparePedidoParity` (S-10) completos pero sin wiring.

## Problema

Sin wiring, el schema PG queda vacío. No hay forma de validar paridad Firestore ↔ PG antes de activar el flip S-10.3. El trigger `onDocumentWritten` separado agregaría latency + cold start adicional, y duplicaría el call graph.

## Cambio

Wiring inline post-commit dentro de `commitPedidoCore` (Opción C del ADR-0016):

- `functions/core/dual-write-pg.js`: módulo nuevo con `replicatePedidoToPg(deps, pedidoId, pedidoDoc)`, fire-and-forget. Ejecuta BEGIN/DELETE/INSERT pedido/INSERT lines/COMMIT dentro de 1 transacción PG. El trigger PG `t_sync_stock_reservations` deriva `stock_reservations` automáticamente.
- `src/pure/dual-write-pg-helpers.js` + mirror `functions/core/dual-write-pg-helpers.js` (§57): SQL building puro (placeholders, serialización JSONB, INSERT multi-row, orden canónico de columnas).
- 2 call sites nuevos en `commit-pedido-core.js`:
  - Idempotent hit (línea 249) → replica `existingPedido.data`.
  - Commit tx OK (línea 760) → replica el shape armado desde `payload` + `resultForClient`.
- Ambos pasan por el helper `_fireAndForgetDualWrite` que atrapa cualquier throw síncrono o asíncrono. **Nunca** bloquea el response al cliente.
- Flag `dual_write_pedidos_enabled` agregado a `src/pure/feature-flags.js` + mirror. Default `false` (safety off).
- Cuando PG falla, `enqueuePendingRetry` escribe en Firestore `dual_write_pending/{pedidoId}` con `set({merge:true})` + `attempts` incrementado via `FieldValue.increment(1)`. Doc id = pedidoId para dedupe natural.
- Rule nueva `firestore.rules`: `match /dual_write_pending/{pedidoId} { allow read, write: if false }`. Solo Admin SDK (el propio CF via `replicatePedidoToPg`).
- Dep nueva `functions/package.json`: `pg@^8.13.0`. Lockfile actualizado.

## Por qué

1. **Latencia mínima**: sin trigger intermediario (sin cold start adicional).
2. **Idempotencia natural por pedidoId**: DELETE antes de INSERT garantiza no duplicados si el replicador corre 2 veces para el mismo pedido (reintentos, idempotent commits, scripts de backfill).
3. **Fire-and-forget** respeta el requisito del prompt: si PG falla, Firestore sigue siendo fuente de verdad; el commit NO rompe ni se demora.
4. **Reusa helpers S-10** (`transformPedidoToPg`) sin tocar su contrato.
5. **Flag OFF por default** garantiza zero riesgo en prod al mergear.

## Verificación

### Tests unit

```bash
npm run test:unit
```

**Resultado**: 3549/3549 PASS (263 test files). 28 tests nuevos del wiring:

- `tests/unit/dual-write-pg-helpers.test.js` — 10 tests SQL building.
- `tests/unit/audit/dual-write-pg-helpers-sync.test.js` — 1 test sync §57.
- `tests/functions/dual-write-commit-pedido.test.js` — 17 tests mock pg + mock fbDb.

### Tests integration contra Cloud SQL staging

```bash
cd backend-new
PGPASSWORD=$(gcloud secrets versions access latest --secret=PG_PASSWORD \
  --project=app-vendedores-staging | tr -d '\r\n') \
DATABASE_URL="postgresql://crm_app:${PGPASSWORD}@127.0.0.1:5433/crm" \
  npx vitest run db/tests/dual-write-integration.test.js
```

**Resultado**: 5/5 PASS contra `app-vendedores-staging:southamerica-east1:crm-staging`:

- T1 — happy path alta 2 líneas (1 ASIG, 1 BO) + stock_reservations derivadas.
- T2 — modificación línea 0 BO → confirmed refleja el cambio.
- T3 — cancelación completa (lines=[]) vacía stock_reservations.
- T4 — reintento idempotente (mismo pedidoId 2 veces) → sin duplicados.
- T5 — flag OFF → no toca PG.

### Typecheck + Biome

```bash
npm run typecheck && npm run lint
```

**Resultado**: 0 errores, 0 warnings.

## Rollback

1. **Soft** (recomendado): flag OFF en `app_config/feature_flags.dual_write_pedidos_enabled` — 1 write Firestore. Zero código.
2. **Hard**: `git revert <sha>` del PR. `dual-write-pg.js` + helpers quedan pero sin consumidores (muertos). Rule `dual_write_pending` cerrada 100% (sin impacto).

## Impacto en prod al mergear (flag OFF default)

**Cero bytes**. Los 2 call sites nuevos ejecutan `replicatePedidoToPg(deps)` que inmediatamente retorna `{ok:false, skipped:'flag_off'}` sin tocar PG ni Firestore. El log `dual_write_skipped_flag_off` queda como señal de que el wiring corre.

## Trade-offs documentados

- **Deuda duplicación SQL inline**: el SQL en `functions/core/dual-write-pg-helpers.js` duplica parcialmente lo que haría el `PedidoRepository` de `backend-new/`. Si el schema PG cambia, hay 2 lugares para ajustar. Mitigación: tests contract comparan `transformPedidoToPg` output contra shape de los INSERT. Backlog: migrar a Opción A una vez el pipeline TS→JS esté armado.
- **Reintentos manuales**: `dual_write_pending` acumula pedidos cuya replicación falló. No hay worker automático hoy — es scope aparte. Operación manual via script (TBD) una vez que haya tráfico de retries acumulado.
- **Secret manager**: `pg.Pool` del server leerá `PG_PASSWORD` desde env (patrón Cloud SQL proxy) cuando se wire en `functions/index.js`. Este PR no wire todavía la instanciación del Pool en el export; solo deja el helper listo para que el deploy posterior lo conecte con `deps.pgPool`.
