# Plan — PostgreSQL schema v0 para pedidos + líneas + reservas

**Fecha**: 2026-11-26
**Decisor**: Mariano
**Autor**: database-architect
**Branch**: `feat/s10-pg-schema-adr001`
**Status**: Draft — pre-ejecución

## Objetivo

Diseñar la **primera versión** del schema PostgreSQL para pedidos + líneas + reservas del CRM Shimano Argentina, que hoy vive en Firestore. **Scope v0, no production-ready.** El objetivo es validar el shape + constraints + tests + tooling antes de abrir la migración gradual (ADR-008 cubre doble escritura).

## Brainstorming (superpowers:brainstorming — expandido)

### Qué resuelve este schema

1. **Constraint duro**: la base NO puede permitir reservar más que el stock libre (hoy la invariante vive en código JS en `getStockBreakdown` + `lineReservesStock`; si un bug del commit entra con reserva > libre, la base lo acepta).
2. **Fuente única de la verdad transaccional**: hoy pedidos vive en Firestore con subcolecciones derivadas en `operations_log`. Sin FK, sin `JOIN`, cada consumidor re-deriva.
3. **Queries rápidas y predecibles** para el piloto React: `WHERE closedAt IS NULL AND assignedVendorUid = $1` debe correr en <50 ms (hoy en Firestore es un `onSnapshot` que trae TODO + filter client-side).
4. **Idempotency robusta**: `pedido_draft_locks` (§64.3) hoy es un doc Firestore con `runTransaction`; en PG es un UNIQUE constraint + `INSERT ... ON CONFLICT DO NOTHING` que paga lo mismo con menos gymnastics.

### Qué NO resuelve (scope out)

- Migración de datos reales (ADR-008 lo cubre).
- Shadow sync Firestore → PG (ADR-008).
- Rollout a producción (ADR-008 + feature flag).
- Modelado de `clientes` master, `roles`, `app_config`, `operations_log` — scope sólo `pedidos`, `lines`, `stock_reservations`, `revision_waitlist`, `ingresos_reparto`, `pedido_draft_locks`.
- Dashboards OLAP (va a BigQuery como hoy, sync separado).

### Decisiones de modelado (A/B, tomo las A)

1. **`lines` como tabla separada vs JSONB en pedidos**:
   - A) tabla separada `pedido_lines` con `(pedido_id, line_index)` composite PK — permite índices compuestos sobre `sku + state`, constraint `qty_open <= qty`, FK integrity, `GROUP BY sku`.
   - B) `pedidos.lines JSONB` — más cerca del shape Firestore (menos fricción de migración) PERO imposibilita el constraint de reserva ≤ libre a nivel SQL + queries sobre líneas individuales son GIN index + jsonb_path_query (lento).
   - **Decisión: A**. La razón de pasar a PG es justamente poder expresar constraints relacionales.

2. **`stock_reservations` separada vs computed on-the-fly**:
   - A) tabla separada `stock_reservations` populated por **trigger** sobre `pedido_lines INSERT/UPDATE/DELETE` — cada línea con `state IN ('ASIG','confirmed','waitlistCpst')` tiene fila 1:1 aquí. UNIQUE constraint `(sku, warehouse, pedido_id, line_index)` + check invariante vía trigger `AFTER` que mira `SUM(qty_open)` por `(sku, warehouse)` vs `stock_snapshot`.
   - B) MATERIALIZED VIEW sobre `pedido_lines` — se refresca periódicamente, NO garantiza invariante en tiempo real.
   - C) Columna `reserves_stock BOOLEAN` computed en `pedido_lines` + VIEW sin tabla separada — simple pero no tenés una tabla para hacer `INSERT INTO stock_reservations (...)` cross-source (ej. `ingresos_reparto` que también reserva).
   - **Decisión: A**. La tabla separada es la que permite el EXCLUDE constraint (ver §3).

3. **Constraint "reservar ≤ stock libre" en SQL**:
   - A) **Trigger `AFTER INSERT/UPDATE OR DELETE` sobre `stock_reservations`** que recomputa `SUM(qty) WHERE sku=NEW.sku AND warehouse=NEW.warehouse AND active=true` y compara con `stock_snapshot.physical_qty`. Si excede → `RAISE EXCEPTION`. Serializado por lock advisory sobre `hashtext(sku||warehouse)`.
   - B) Check constraint `CHECK (...)` — PG no permite subqueries en CHECK constraints a nivel tabla.
   - C) Exclusion constraint con `tstzrange` — no aplica, el dominio es cantidad, no tiempo.
   - **Decisión: A trigger + advisory lock**. Patrón estándar PG para invariantes agregadas. Alternativa en v1: convertirlo en SERIALIZABLE isolation level en el procedure de reserva; pero el trigger protege además contra INSERT directo de admin.

4. **Materialized view `stock_breakdown` vs VIEW regular**:
   - A) MATERIALIZED VIEW refreshed on-demand — rápida de leer, stale.
   - B) VIEW regular — siempre fresca, costo al leer.
   - **Decisión: B (VIEW regular) por ahora**. El schema v0 no persigue latencia optimizada; `stock_breakdown` se puede materializar en v1 si profiling muestra que es cuello. El cálculo es simple (3 LEFT JOIN + SUM GROUP BY).

5. **Idempotency / draft locks**:
   - A) Tabla `pedido_draft_locks` con PK `draft_id` + UNIQUE + `INSERT ... ON CONFLICT (draft_id) DO NOTHING RETURNING pedido_id`. Si no vino de vuelta → existía, hago SELECT.
   - B) UNIQUE constraint directo en `pedidos.draft_id` — más simple, pero sin el "select the existing on conflict" flow limpio.
   - **Decisión: A** porque el lock es un contrato explícito (shape del ADR), y la tabla separada permite CLEANUP policies (ej. TTL 30d sobre locks huérfanos).

6. **Multi-warehouse (dep 11 / dep 12)**:
   - Columna `warehouse SMALLINT NOT NULL` en `stock_reservations` + `stock_snapshot`. CHECK `warehouse IN (11, 12)`.
   - `pedido_lines.en_transito BOOLEAN` + `pedido_lines.asig_at_transito TIMESTAMPTZ` + `pedido_lines.en_dep11_at TIMESTAMPTZ` (mirror directo del shape Firestore §107).
   - Trigger lee `line.en_transito` para decidir si la reserva va al bucket 11 o 12. Convención: `en_transito=TRUE` → reserva contra warehouse=12; `en_transito=FALSE` → warehouse=11.

7. **`state` como ENUM o TEXT CHECK**:
   - A) ENUM PG nativo `line_state_enum`. Type-safe + extensible via ALTER TYPE.
   - B) TEXT CHECK `IN (...)`. Más flexible pero verboso.
   - **Decisión: A**. Los estados son estables (BO/ASIG/confirmed/invoiced/cancelled). ALTER TYPE agrega valores sin table rewrite en PG 12+.

## Lo que NO es trivialmente modelable en PG vs Firestore (documentar y seguir)

### 1. Shape dinámico de `pedido.lines[i]` con campos opcionales por flow

Firestore permite `pedido.lines[i].asigRevertidaReason` que existe solo en algunos casos (§40.5, §40.6, §40.7). En PG serían NULL — fine, pero el shape queda más "ancho" (muchas columnas NULLables).

**Decisión v0**: mapear a columnas NULLables. v1 puede meter los campos de audit en JSONB `audit_jsonb` si crece el set.

### 2. `operations_log` con shape variable por `type`

Firestore hace un doc por evento con `{ type, ...payload }` libre. En PG es append-only con JSONB `payload` + columna `type TEXT NOT NULL`. **Scope-out** de este v0 (no lo incluyo).

### 3. Arrays de `asigRefs[]` dentro de líneas

El pure `collectAsigRefsForItemCancel` navega `w.items[idx].asigRefs[]` (array de `{pedidoId, lineIndex, qty}`). En PG se modelaría como tabla `waitlist_asig_refs(waitlist_id, item_index, pedido_origen_id, line_index, qty)`. **Scope v0**: lo incluyo porque el feature CPST lo necesita. 1 tabla más.

### 4. `warehouseBreakdown` del snapshot como JSON string

El sync SAP vive en Python/Node y escribe `app_config/stock_snapshot.warehouseBreakdown` como JSON string. En PG sería `stock_snapshot(sku TEXT, warehouse SMALLINT, physical_qty INT, PRIMARY KEY(sku, warehouse))`. **Scope v0**: incluyo la tabla pero sin el sync — eso vive en ADR-008.

### 5. onSnapshot realtime del cliente

Firestore empuja cambios por WebSocket. PG no tiene equivalente nativo. Alternativas (**scope-out**):
- `LISTEN/NOTIFY` + WebSocket relay en el backend.
- Supabase Realtime (si la tool final es Supabase, no Cloud SQL).
- Polling cada N segundos.

Esto es un **cambio real** de modelo mental para el frontend; lo documento en el ADR pero no lo resuelvo acá.

## Herramienta de migración — recomendación

| Tool | Pro | Contra |
|---|---|---|
| **Flyway** | Industry standard, maduro, SQL puro, CLI simple | Requiere Java runtime en CI y dev — fricción extra para equipo Node |
| **node-pg-migrate** | Node puro (consistente con stack `functions/`), SQL puro con wrappers JS | Menos "famoso" que Flyway pero ampliamente usado |
| **Prisma Migrate** | TypeScript codegen incluido, cliente type-safe, buena DX | Opinión fuerte (ORM-first) que acoplaría el resto del backend a Prisma; el core puro del repo es JS vanilla y no es trivial introducir TS |

**Decisión: `node-pg-migrate`**.

Razones:
1. El stack ya es Node (functions, pure helpers, tests Vitest). Agregar Java solo para Flyway es overkill en v0.
2. Prisma es excelente pero obliga a definir todo via `schema.prisma` + genera cliente — es acople prematuro cuando aún estamos validando el shape.
3. `node-pg-migrate` acepta migraciones en SQL puro (`.sql`) o en JS (`exports.up/down`). Las SQL son portables (si pivot a Flyway en v1 es copy-paste).
4. CLI simple: `npm run migrate:up` / `migrate:down`. Integra en CI con misma toolchain Node del repo.

Alternativa aceptable si Mariano prefiere SQL puro sin wrapper: dejar las migraciones como `.sql` files + un `psql -f` manual, tooling mínimo. Lo descarto porque pierde el tracking de "qué migración se corrió" (`pgmigrations` meta-table).

## Shape propuesto (resumen 5 líneas)

1. **`pedidos`**: cabecera (cliente, vendor, draft_id UNIQUE, closed_at, timestamps, flags SAP).
2. **`pedido_lines`**: 1 fila por SKU por pedido, estado ENUM, qty + qty_open + qty_cancelled, audit fields, `en_transito`.
3. **`stock_reservations`**: fila sincronizada con cada `pedido_lines` que reserva. Trigger valida `SUM(qty) ≤ physical_qty` por `(sku, warehouse)`.
4. **`stock_snapshot`**: físico actual por `(sku, warehouse)`. Fuente: sync SAP (fuera de scope v0).
5. **`pedido_draft_locks`** + **`revision_waitlist`** + **`waitlist_asig_refs`** + **`ingresos_reparto`**: idempotency + CPST + reparto Pablo.

## Call-sites del piloto que justifican índices

Grep en `functions/core/*.js` confirmó los patterns dominantes:

| Query | Índice que la soporta |
|---|---|
| `pedidos WHERE closedAt IS NULL` (14+ call-sites) | Partial index `WHERE closed_at IS NULL` |
| `pedidos WHERE _draftId = $1 LIMIT 1` (§64.3) | UNIQUE constraint sobre `draft_id` |
| `pedidos WHERE assignedVendorUid = $1 AND closedAt IS NULL` (§59 VDE filter) | Composite index `(assigned_vendor_uid, closed_at)` partial |
| `pedido_lines WHERE sku = $1 AND state IN ('ASIG','confirmed')` (breakdown por SKU) | Composite index `(sku, state)` partial `WHERE state IN (...)` |
| `revision_waitlist WHERE assigned_vendor_uid = $1` | Index sobre `assigned_vendor_uid` |

## Plan de ejecución

1. Escribir `backend-new/db/schema/0001_initial.sql` (DDL + ENUMs + triggers + funciones + índices + constraints).
2. Escribir `backend-new/db/schema/README.md` (convenciones de naming, cómo correr migraciones, rollback).
3. Escribir `backend-new/package.json` (deps: pg, vitest, node-pg-migrate, testcontainers o fallback a DATABASE_URL).
4. Escribir `backend-new/db/tests/setup.js` (helper: `getPool()` con skip condicional).
5. Escribir `backend-new/db/tests/fixtures.js` (1 cliente, 3 SKUs, 5 pedidos).
6. Escribir 4-5 tests Vitest:
   - crear pedido + línea + reserva happy path.
   - violar invariante reserva > físico → excepción del trigger.
   - draft lock idempotency (2 commits del mismo draft_id).
   - FIFO ASIG (dos líneas del mismo SKU, la que tiene `asig_at` más viejo consume primero).
   - en_transito reserva en warehouse 12, no 11.
7. Escribir `docs/adr/0001-modelo-datos-pedidos-pg.md` (Status Accepted, decisor Mariano, decisiones + alternativas descartadas).
8. Commit + push + PR (sin merge).

## Verificación local (sin correr PG)

Si no hay PG local, los tests levantan `testcontainers-node` (si tiene docker) o hacen `test.skipIf(!process.env.DATABASE_URL)` con mensaje claro. Documentar en README cómo levantar `docker run -p 5432:5432 -e POSTGRES_PASSWORD=dev postgres:16` + `export DATABASE_URL=postgresql://postgres:dev@localhost:5432/postgres`.

## Riesgos

- **Trigger de invariante con `pg_advisory_xact_lock`**: si el stock_snapshot se actualiza concurrente con una reserva, el lock evita race. Pero el stock_snapshot se refresca via UPDATE sin pasar por el trigger de reservations — si el stock baja debajo de reservations existentes, el trigger NO se ejecuta y queda invariante violada silenciosamente. **Mitigación v0**: trigger adicional sobre `stock_snapshot UPDATE` que detecta el caso y rechaza O marca reservations como `invalid` (en v0 opto por **rechazar** el update del snapshot si deja reservations sin cobertura — más conservador; en v1 se podría cambiar a "aceptar + cascada de sobre_asignada=true").

- **Shape lock vs real contention**: si 100 vendedores commiten simultáneo sobre el mismo SKU, el advisory lock serializa todos. En v0 asumimos que esto es aceptable (el throughput real es <1 commit/sec por SKU hot). v1 puede explorar OPTIMISTIC concurrency.

## Verification before completion

- `npm run migrate:up` debe correr en DB vacía.
- `npm test` (Vitest) debe pasar los 5 tests.
- ADR tiene las 5 secciones estándar (Context, Decision, Alternatives, Consequences, Status).
- PR opens con link al ADR + al plan.
- Scope aislado: `git diff --stat main..HEAD` NO toca `functions/`, `index.html`, `src/`, `firestore.rules`.
