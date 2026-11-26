# backend-new/db/schema

Schema PostgreSQL v0 para pedidos + líneas + reservas del CRM Shimano Argentina.

Ver [ADR-001](../../../docs/adr/0001-modelo-datos-pedidos-pg.md) para contexto + decisiones.

## Status

- **v0**: validación de shape + constraints + tooling. **No production-ready**.
- **Target**: Cloud SQL PostgreSQL 16, mismo proyecto GCP que las Cloud Functions.
- **Migración desde Firestore**: fuera de scope de este directorio — ver ADR-008 (doble escritura).

## Herramienta de migración

**[`node-pg-migrate`](https://salsita.github.io/node-pg-migrate/)** — ver ADR-001 §Herramienta de migración para justificación.

Ventajas vs Flyway / Prisma Migrate:
1. Puro Node (consistente con stack `functions/` + tests Vitest del repo).
2. Acepta migraciones `.sql` puras (portable a Flyway si pivotamos en v1).
3. CLI simple (`npm run migrate:up/down`) sin dep de Java runtime.
4. No obliga a adoptar ORM (vs Prisma, que mete `schema.prisma` + codegen).

## Convenciones

### Naming

- **Tablas**: `snake_case` plural (`pedidos`, `stock_reservations`).
- **Columnas**: `snake_case` singular (`assigned_vendor_uid`, `asig_at`).
- **Enums**: `_enum` sufijo (`line_state_enum`, `warehouse_enum`).
- **Índices**: `ix_<tabla>_<campos>`.
- **Índices únicos**: `uq_<tabla>_<campos>`.
- **Triggers**: `t_<tabla>_<acción>`.
- **Funciones**: `fn_<acción>` o `<verbo>_<objeto>` (ej. `line_reserves_stock`).

### Tipos

- **Fechas**: siempre `TIMESTAMPTZ`. Nunca `TIMESTAMP` sin TZ.
- **Dinero**: `NUMERIC(14,2)` para ARS (hasta 999_999_999_999.99).
- **Cantidades**: `INTEGER` (nunca BIGINT — SKU/unidad nunca excede int32).
- **IDs**: `TEXT` compat Firestore (`pedidos.id`), autogenerados con `pgcrypto`
  (`'p_' || encode(gen_random_bytes(10), 'hex')`). Migrar a UUID queda para v1.

### Constraints

- Preferir **check constraints** sobre triggers cuando sea posible (más barato).
- **Triggers** para invariantes agregadas (reserva ≤ físico) — ver `fn_check_reservation_invariant`.
- **Advisory locks** (`pg_advisory_xact_lock`) en el trigger de sync para serializar reservas del mismo `(sku, warehouse)`.
- **Partial unique indexes** para UNIQUE que permite NULLs (ej. `draft_id`).

## Cómo correr las migraciones

### 1. Levantar PostgreSQL local (opción docker)

```bash
docker run --name shimano-pg-v0 \
  -e POSTGRES_PASSWORD=dev \
  -e POSTGRES_DB=shimano_crm_dev \
  -p 5432:5432 \
  -d postgres:16

# Esperar que arranque:
docker logs -f shimano-pg-v0
# (Ctrl-C cuando veas "database system is ready to accept connections")

export DATABASE_URL="postgresql://postgres:dev@localhost:5432/shimano_crm_dev"
```

### 2. Correr migraciones

Desde `backend-new/`:

```bash
npm install
npm run migrate:up
```

Esto corre `0001_initial.sql` y registra en la meta-table `pgmigrations`.

### 3. Rollback

```bash
npm run migrate:down
```

Ejecuta el `DOWN` de la última migración aplicada. **Aviso**: `0001_initial.sql` no tiene DOWN (es la primera y el rollback es `DROP SCHEMA public CASCADE`).

Para resetear completo en dev:

```bash
docker exec -it shimano-pg-v0 psql -U postgres -d shimano_crm_dev -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
npm run migrate:up
```

## Cómo agregar una migración

```bash
npm run migrate:create -- add_comments_to_pedidos
# Genera: db/schema/000N_add_comments_to_pedidos.sql con placeholders UP/DOWN.
```

Convenciones:
- Un archivo = una decisión lógica.
- Siempre incluir `DOWN` (aunque sea `-- irreversible` con comentario explícito).
- No modificar archivos ya aplicados en main (añadir migración nueva).
- Prefijo numérico de 4 dígitos (`0002_...`, `0003_...`).

## Shape resumido

```
pedidos (id PK, order_number UNIQUE, client, vendor, draft_id UNIQUE, timestamps)
  └── pedido_lines (pedido_id FK, line_index) PK composite
        ├── state ENUM (BO/ASIG/confirmed/invoiced/cancelled)
        ├── qty, qty_open, qty_cancelled
        ├── en_transito, asig_at_transito, en_dep11_at
        └── asig_revertida_* (audit §40.5-§40.7)

stock_snapshot (sku, warehouse) PK
  └── physical_qty (trigger guard: no bajar debajo de SUM(reservations))

stock_reservations (pedido_id, line_index) PK, 1:1 con lines que reservan
  └── Trigger: SUM(qty) WHERE sku+warehouse <= stock_snapshot.physical_qty

revision_waitlist (id PK, vendor, items JSONB)
  └── waitlist_asig_refs (waitlist_id, item_index, pedido_origen_id, line_index_origen)

ingresos_reparto (id PK, sku, qty, status, source dep11|dep12)
pedido_draft_locks (draft_id PK, pedido_id FK) — idempotency §64.3

VIEW v_stock_breakdown (equivalente a getStockBreakdown §39, read-only)
```

## Pitfalls conocidos (v0)

### 1. Constraint trigger vs normal trigger

El trigger `t_stock_reservations_check_invariant` está declarado como `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY IMMEDIATE`. En v0 queda IMMEDIATE (chequea en cada statement). Si en v1 queremos permitir "reservar transitoriamente > físico dentro de una transacción compleja y rebalancear antes del COMMIT", podemos `SET CONSTRAINTS t_stock_reservations_check_invariant DEFERRED` en la sesión.

### 2. Advisory lock + cross-transaction interleaving

El advisory lock protege contra 2 transacciones concurrentes sobre el mismo `(sku, warehouse)`. Si una tx hace UPDATE lines + UPDATE snapshot, el orden importa:
- Correcto: snapshot subir → lines update (más holgura).
- Correcto: lines decrease → snapshot bajar.
- **Peligroso**: lines increase + snapshot NO cambió → el trigger invariante rebota (expected).

### 3. `warehouse_enum` para tablas separadas vs single-table

Opté por valores `'dep_11'` y `'dep_12'`. Si en el futuro agregás un `'dep_13'` (expansión BA), `ALTER TYPE warehouse_enum ADD VALUE 'dep_13'`. **No podés QUITAR valores** sin recrear el enum — plan conservador.

### 4. `v_stock_breakdown` como VIEW (no materializada)

En v0, cada read re-computa el aggregate. Si el throughput real excede ~1000 lecturas/segundo con 10k lines activas, migrar a MATERIALIZED VIEW + REFRESH CONCURRENTLY cada N segundos. El shape de la VIEW es intencionalmente mínimo — faltan buckets `waitlist_cpst`, `reparto_abierto`, `sobre_asignada` (ver ADR-001 §Scope-out v1).

## Tests

Ver `backend-new/db/tests/README.md` para cómo correr los tests Vitest.

TL;DR: `npm test` con `DATABASE_URL` seteado. Sin DB disponible, los tests se saltan con mensaje claro.
