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

Cada test corre en una **transaction que rollbackea al final** (via `BEGIN` + `ROLLBACK` wrapper del helper `withTx(cb)`). Esto evita cleanup manual y permite correr los tests en cualquier orden sin contaminar.

**Excepción**: los tests que validan triggers `CONSTRAINT TRIGGER ... IMMEDIATE` necesitan `COMMIT` real para disparar — en esos casos, limpian la tabla al final.

## Setup

El helper `setup.js`:
1. Lee `DATABASE_URL`.
2. Si no existe → `describe.skip(...)` el archivo.
3. Si existe → antes de todo, corre `0001_initial.sql` idempotente (via `IF NOT EXISTS` y `CREATE OR REPLACE`).

**Nota**: la primera corrida sobre DB vacía toma ~1-2 segundos (CREATE TYPE + CREATE TABLE + CREATE INDEX). Las siguientes son <100 ms (DDL idempotente).
