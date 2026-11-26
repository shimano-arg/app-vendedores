# backend-new/db/tests

Tests Vitest contra PostgreSQL 16 para validar el schema v0.

## Cómo correr

### Opción 1: PG local vía docker (recomendado)

```bash
# Terminal 1 — levantar PG:
docker run --name shimano-pg-v0 \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=shimano_crm_test \
  -p 5432:5432 \
  --rm \
  postgres:16

# Terminal 2 — correr tests:
cd backend-new
export DATABASE_URL="postgresql://postgres:dev@localhost:5432/shimano_crm_test"
npm install
npm test
```

### Opción 2: PG ya instalado

```bash
# Crear DB dedicada de tests:
createdb shimano_crm_test
export DATABASE_URL="postgresql://$USER@localhost:5432/shimano_crm_test"
npm test
```

### Opción 3: sin PG disponible

```bash
# Los tests detectan la ausencia de DATABASE_URL y skipean con mensaje claro.
npm test
# => "[skipped] DATABASE_URL no definido — tests requieren PostgreSQL."
```

## Qué cubren los tests

| Archivo | Caso cubierto |
|---|---|
| `schema.smoke.test.js` | Migración aplicada correctamente (tablas, enums, triggers existen). |
| `pedido-happy-path.test.js` | Crear pedido + línea ASIG + reserva aparece en stock_reservations. |
| `invariante-reserva.test.js` | Reservar > físico rebota `STOCK_RESERVATION_OVERRUN`. |
| `draft-lock-idempotency.test.js` | 2 commits con mismo `draft_id` → 1 solo pedido (idempotency §64.3). |
| `fifo-asig.test.js` | 2 ASIG mismo SKU, orden por `asig_at` en `v_stock_breakdown`. |
| `en-transito.test.js` | Línea `en_transito=TRUE` reserva en `dep_12`, no `dep_11`. |

## Fixture mínima

`fixtures.js` siembra:
- 1 cliente master: `C001` ("cliente A").
- 1 vendedor: `vendedor-01`.
- 3 SKUs con stock físico en `dep_11`:
  - `SKU-AAA-001` — físico 10 u dep_11, 0 u dep_12.
  - `SKU-BBB-002` — físico 5 u dep_11, 3 u dep_12.
  - `SKU-CCC-003` — físico 0 u dep_11, 20 u dep_12 (todo tránsito).
- 0 pedidos (cada test crea los suyos).

## Isolation

**Schema aislado `crm_test`** (default). El helper `setup.js` NUNCA toca el schema `public` del DB conectado — crítico cuando se corre contra `crm` de staging donde `public` tiene data compartida. En cada corrida:

1. `DROP SCHEMA IF EXISTS "crm_test" CASCADE`.
2. `CREATE SCHEMA "crm_test"`.
3. `SET search_path TO "crm_test", public`.
4. Aplicar `0001_initial.sql` dentro del schema aislado.

El pool `pg` corre con `options: '-c search_path=crm_test,public'`, por lo que todas las queries de los tests resuelven contra `crm_test.*` sin que haga falta calificar.

Para correr paralelo con otro schema (ej. CI matrix): `PG_TEST_SCHEMA=crm_test_run_123 npm test`.

**Dentro de la corrida**: los tests que no necesitan `COMMIT` real (la mayoría) usan el helper `withTx(cb)` que hace `BEGIN` + `ROLLBACK`. Los tests que validan `CONSTRAINT TRIGGER ... IMMEDIATE` necesitan `COMMIT` — hacen `TRUNCATE ... RESTART IDENTITY CASCADE` en `beforeEach` para limpiar.

## Setup

El helper `setup.js`:
1. Lee `DATABASE_URL`.
2. Si no existe → `describe.skip(...)` el archivo entero.
3. Si existe → antes de todo, recrea el schema `crm_test` (o `PG_TEST_SCHEMA` si se override) y aplica `0001_initial.sql`.

**Nota**: la recreación del schema toma ~1-2 segundos por el DDL (CREATE TYPE + CREATE TABLE + CREATE INDEX). Recorre una sola vez por `npm test` (`ensureSchemaApplied` es idempotente intra-proceso vía flag `schemaApplied`).
