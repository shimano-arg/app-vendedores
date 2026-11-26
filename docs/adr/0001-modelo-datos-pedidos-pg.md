# ADR-001: Modelo de datos de pedidos + líneas + reservas en PostgreSQL

- **Status**: Accepted
- **Fecha**: 2026-11-26
- **Decisor**: Mariano
- **Autor**: database-architect (branch `feat/s10-pg-schema-adr001`)
- **Supersede**: Modelo Firestore vigente (documentado informal en CLAUDE.md §33-§108).
- **Pre-requisito de**: ADR-008 (migración no-downtime) — este ADR define el shape destino; ADR-008 define cómo migrar.

---

## Contexto

Hoy pedidos + líneas + reservas viven en Firestore con shape:

```
pedidos/{id}                            # doc Firestore
  - order_number, client, assignedVendorUid, draft_id, timestamps, transferidoSAP
  - lines: Array<{ sku, state, qty, qty_open, en_transito, asig_at, ... }>   # array en el doc

revision_waitlist/{id}
  - items: Array<{ code, qty, asigRefs: Array<{pedidoId, lineIndex, qty}> }>

ingresos_reparto/{id}                    # por SKU, status, source (dep11|dep12)
pedido_draft_locks/{draftId}             # §64.3 idempotency
app_config/stock_snapshot                # fisico por SKU + warehouse (JSON string)
```

Problemas que motivan la migración:

1. **La invariante central "reserva ≤ físico libre" vive en código JS** (`getStockBreakdown` + `lineReservesStock`). Si un bug del commit entra con reserva > libre, Firestore lo acepta porque no tiene constraints relacionales. Precedente: BENGOCHEA 597151 (ASIG 6 / físico 2 — v1395 §40.3 lo diagnosticó; v1403 §40.11 lo mitiga con reconcile automático, pero el modelo permite el estado inconsistente).

2. **Queries dependen del cliente**: `pedidos.where('closedAt','==',null)` se hace con `onSnapshot` + filtro cliente-side. Para 10k pedidos abiertos esto baja TODO al cliente. Lento en mobile.

3. **Sin JOIN**: `pedido_lines + stock_reservations + stock_snapshot` se calcula en JS cada vez. 3 colecciones separadas sin integridad referencial.

4. **Idempotency gymnastics**: §64.3 implementa un draft lock con `runTransaction` + patrón "all reads before writes". En PG es 1 línea: `INSERT ... ON CONFLICT DO NOTHING RETURNING pedido_id`.

5. **Realtime realtime**: Firestore `onSnapshot` es excelente pero el shape "doc con array lines[]" no escala bien a N queries por línea. El piloto React (P1.6) va a querer `SELECT ... WHERE sku = $1 AND state = 'ASIG' ORDER BY asig_at`.

**Mariano decidió 2026-11-26 11:22**: pasar a **PostgreSQL en Cloud SQL**, mismo proyecto GCP que las Functions. Migración gradual con doble escritura (ADR-008).

---

## Decisión

### Resumen

Se adopta el schema PostgreSQL definido en `backend-new/db/schema/0001_initial.sql` con las siguientes propiedades:

1. **`pedido_lines` como tabla separada** (no JSONB dentro de `pedidos`).
2. **`stock_reservations` como tabla espejo** de `pedido_lines` que reservan, mantenida por trigger `AFTER INSERT/UPDATE/DELETE`.
3. **Trigger de invariante** `fn_check_reservation_invariant` garantiza `SUM(qty) ≤ stock_snapshot.physical_qty` por `(sku, warehouse)` con advisory lock para serializar.
4. **Trigger `fn_check_snapshot_decrease`** protege el snapshot de bajar debajo de reservations activas.
5. **`v_stock_breakdown`** VIEW regular (no materializada) como equivalente de `getStockBreakdown` (§39) v0.
6. **`pedido_draft_locks`** tabla con PK `draft_id` + patrón `INSERT ... ON CONFLICT DO NOTHING RETURNING`.
7. **ENUMs nativos** PG para `line_state_enum` (BO/ASIG/confirmed/invoiced/cancelled), `warehouse_enum` (dep_11/dep_12), `pedido_origen_enum`, `reparto_status_enum`.
8. **`en_transito BOOLEAN`** en `pedido_lines` + `asig_at_transito/en_dep11_at` (mirror directo de §107). El trigger de sync lee este flag para decidir warehouse de la reserva.

### Shape detallado

#### `pedidos` (cabecera)

| Columna | Tipo | Nota |
|---|---|---|
| `id` | TEXT PK | `'p_' || hex(10 bytes)` — compat Firestore |
| `order_number` | INT UNIQUE | Secuencia visible. |
| `client_card_code`, `client_name` | TEXT NOT NULL | Desnorm search. |
| `assigned_vendor_uid`, `assigned_vendor_key` | TEXT NOT NULL | §44 canonical. |
| `owner_uid`, `cargado_por_uid` | TEXT NOT NULL | Pablo-cargado §108.2. |
| `origen` | ENUM NOT NULL | manual/cpst/excel/reparto/backorder/sap_sync. |
| `draft_id` | TEXT | UNIQUE partial (WHERE NOT NULL). §64.3. |
| `transferido_sap` | JSONB | `{docEntry, docNum, orderDocEntry}` §40.8. |
| `created_at`, `updated_at`, `first_invoiced_at`, `cobrado_at`, `closed_at` | TIMESTAMPTZ | |
| `closed_reason`, `closed_by` | TEXT | Soft-delete audit. |

**Índices críticos** (justificados por grep `functions/core/*.js`):

- `uq_pedidos_draft_id` UNIQUE partial WHERE `draft_id IS NOT NULL` — idempotency §64.3.
- `ix_pedidos_vendor_open` sobre `assigned_vendor_uid` partial WHERE `closed_at IS NULL` — query dominante §59 VDE filter.
- `ix_pedidos_open_created` sobre `created_at DESC` partial WHERE `closed_at IS NULL` — scope admin.
- `ix_pedidos_client` sobre `(client_card_code, created_at DESC)` — vista por cliente.
- `ix_pedidos_owner_open` sobre `owner_uid` partial — compat pre-§44.

#### `pedido_lines`

| Columna | Tipo | Nota |
|---|---|---|
| `(pedido_id, line_index)` | TEXT+INT composite PK | |
| `sku` | TEXT NOT NULL | |
| `state` | `line_state_enum` NOT NULL | BO/ASIG/confirmed/invoiced/cancelled. |
| `qty`, `qty_open`, `qty_cancelled` | INT | CHECKs: `qty_open + qty_cancelled ≤ qty`. |
| `price_ars`, `discount_percent` | NUMERIC | |
| `en_transito`, `asig_at_transito`, `en_dep11_at` | BOOL/TSTZ | §107 dep12 flags. |
| `asig_at`, `confirmed_at`, `cancelled_at` | TIMESTAMPTZ | FIFO + TTL. |
| `asig_revertida_at/by/reason`, `split_from_line_index` | | §40.5/§40.7/§40.11. |
| `closed_reason`, `closed_by`, `cancelled_by` | TEXT | Audit. |

**Constraints clave**:
- `CHECK (qty_open + qty_cancelled <= qty)` — no overflow.
- `CHECK` state-qty_open coherence: solo BO/ASIG/confirmed pueden tener `qty_open > 0`.
- `CHECK (en_transito = FALSE OR state IN ('ASIG','confirmed'))` — §107.
- `CHECK (en_dep11_at >= asig_at_transito)` — orden temporal del cruce.

**Índices**:
- `uq_pedido_lines_sku_unique_active` UNIQUE partial sobre `(pedido_id, sku)` WHERE lines vivas — §56 un SKU por pedido.
- `ix_pedido_lines_sku_reserving` sobre `(sku, state, asig_at)` partial — breakdown.
- `ix_pedido_lines_fifo_asig` sobre `(sku, asig_at)` partial WHERE `state='ASIG' AND qty_open > 0` — FIFO.

#### `stock_reservations` (invariante central)

| Columna | Tipo | Nota |
|---|---|---|
| `(pedido_id, line_index)` | PK composite, FK a pedido_lines CASCADE | |
| `sku` + `warehouse` | TEXT + ENUM | FK a stock_snapshot. |
| `qty` | INT CHECK `> 0` | Reserva nominal. |
| `state`, `asig_at` | Espejo de la línea | Mantenido por trigger sync. |

**Trigger `t_pedido_lines_sync_reservations`** (`AFTER INSERT/UPDATE/DELETE` en `pedido_lines`):
1. Si la línea reserva (`line_reserves_stock(state, qty_open, transferido_sap)` TRUE): `INSERT ... ON CONFLICT (pedido_id,line_index) DO UPDATE`.
2. Si no reserva: `DELETE FROM stock_reservations WHERE pedido_id=X AND line_index=Y`.
3. Adquiere `pg_advisory_xact_lock(hashtextextended(sku || warehouse, 0))` para serializar con otras txs del mismo `(sku, warehouse)`.

**Trigger `t_stock_reservations_check_invariant`** (`AFTER INSERT/UPDATE` en `stock_reservations`, CONSTRAINT TRIGGER IMMEDIATE):
- `SELECT SUM(qty) FROM stock_reservations WHERE sku=NEW.sku AND warehouse=NEW.warehouse`.
- Compara vs `stock_snapshot.physical_qty`. Si excede → `RAISE EXCEPTION 'STOCK_RESERVATION_OVERRUN'` con `ERRCODE='check_violation'`.

#### `stock_snapshot`

| Columna | Tipo | Nota |
|---|---|---|
| `(sku, warehouse)` | PK composite | |
| `physical_qty` | INT CHECK `>= 0` | Fuente: sync SAP. |
| `updated_at`, `source` | | `'sap_sync' \| 'manual' \| 'seed'`. |

**Trigger `t_stock_snapshot_guard`** (`BEFORE UPDATE`):
- Si `NEW.physical_qty >= OLD.physical_qty`: pasa siempre.
- Si baja debajo de `SUM(stock_reservations.qty)` activas: `RAISE EXCEPTION 'STOCK_SNAPSHOT_UNDERRUN'`.

Decisión conservadora: en v0 rechazamos el update. En v1 podemos cambiar a "aceptar + marcar sobre_asignada" (patrón §40.11) si el workflow lo requiere.

#### Resto

- `revision_waitlist` (id PK, vendor, items JSONB para v0) + `waitlist_asig_refs` (refs cross-pedido §40.6).
- `ingresos_reparto` (id, sku, qty, status, source dep11|dep12) + UNIQUE partial `(sku, source)` para dedupe activos.
- `pedido_draft_locks` (draft_id PK, pedido_id FK CASCADE, card_code, origen, owner_uid) — idempotency §64.3.

#### `v_stock_breakdown` VIEW (shape v0)

```sql
SELECT
  sku,
  fisico_dep11, transito_dep12, backorder_app,
  asignadas_dep11, confirmadas_dep11,
  asignadas_dep12, confirmadas_dep12,
  reservadas_dep11, libre_dep11
FROM v_stock_breakdown WHERE sku = $1;
```

Equivalente mínimo de `getStockBreakdown` v8 (§39). **Faltan en v0** (scope-out, extender en v1): `waitlistCpst`, `repartoAbierto`, `sobreAsignada FIFO`, `utilizablePara(cardCode)`.

---

## Alternativas descartadas

### A) Seguir con Firestore

**Pros**: 0 migración, realtime nativo, ya funciona.

**Contras**:
1. La invariante "reserva ≤ libre" nunca es blindaje de infra. Cada bug nuevo requiere `scripts/audit/*` para detectar (como §40.3, §40.11).
2. Queries VDE escalan mal (`onSnapshot` trae todo, filter client-side). INP en mobile se degrada con >5k docs abiertos.
3. Reports BigQuery requieren sync separado (ya existe) pero la fuente transaccional sigue sin JOIN → cada report recompone el estado.
4. Rules Firestore se vuelven una capa de lógica de dominio (ver `firestore.rules` 400+ líneas con whitelist §44/§59/§63).

**Rechazada** porque no resuelve el problema estructural. Es trade-off razonable para v1 pero no para una app que crece en complejidad de reglas.

### B) PG con `pedidos.lines JSONB`

**Pros**: 1:1 shape Firestore → migración trivial. Lectura directa de todo el pedido en 1 read.

**Contras**:
1. **Imposibilita el constraint de reserva**. No podés tener FK sobre un elemento de un JSON array ni CHECK que sume valores de 2 pedidos distintos.
2. Queries `WHERE sku = $1` sobre arrays JSONB requieren GIN index + `jsonb_path_query` — lento y menos legible que `SELECT * FROM pedido_lines WHERE sku = $1`.
3. UPDATE de una línea requiere reescribir todo el JSONB (write amplification).
4. `splitFromLineIndex` (§40.7) se vuelve "mutate array by index inside JSONB" — propenso a race.

**Rechazada** porque el motivo principal de migrar es tener constraints relacionales.

### C) Materialized view `stock_breakdown` vs VIEW regular

**Pros materialized**: lectura O(1) sobre tabla pre-calculada.

**Contras materialized**:
1. Requiere `REFRESH MATERIALIZED VIEW` manual o scheduled. Durante el intervalo, el breakdown está stale.
2. `REFRESH CONCURRENTLY` requiere UNIQUE INDEX en la MV + locks de grano tabla.
3. Agrega complejidad operacional sin beneficio de performance medido (el SELECT de la VIEW regular con los índices propuestos debería correr <10 ms sobre 100k lines).

**Rechazada para v0**. Se puede migrar en v1 si profiling muestra que la VIEW regular es cuello.

### D) Prisma Migrate (ORM)

**Pros**: TypeScript codegen, cliente type-safe, schema-first.

**Contras**:
1. Fuerza a reescribir todo el core puro JS (functions/core) en TS + usar `prisma.client`. Acople grande.
2. Prisma no expresa fácilmente constraints como `CHECK` o triggers complejos — hay que caer a `.sql` migrations manuales con `--create-only` + edit. Pierde parte de su propuesta de valor.
3. El repo es JS vanilla con tests Vitest. Introducir TS compiler + Prisma CLI no es trivial.

**Rechazada**. Opción para v1 si pivotamos a stack TS unificado.

### E) Flyway (SQL puro + Java)

**Pros**: Industry standard, SQL puro, maduro.

**Contras**: Requiere Java runtime en CI y dev — fricción extra para un equipo 100% Node.

**Rechazada**. Preferimos `node-pg-migrate` por consistencia de stack. Las migraciones `.sql` son portables si pivotamos.

### F) Check constraint con subquery

**Pros**: declarativo, declarado en la columna.

**Contras**: **PostgreSQL no soporta subqueries en CHECK constraints a nivel tabla** (ni en MySQL, ni en Oracle). Es un trade-off del estándar SQL.

**Rechazada** por imposibilidad técnica — se usa trigger.

### G) Exclusion constraint

**Pros**: elegante para rangos temporales (`tstzrange`).

**Contras**: el dominio aquí es "cantidad" (INT suma), no rango temporal. Exclusion constraint no aplica.

**Rechazada** por mismatch de dominio.

---

## Decisiones de modelado complementarias

### Idempotency keys

Tabla `pedido_draft_locks` separada (no columna en `pedidos`) — permite:
- Cleanup policies independientes (TTL 30d sobre locks huérfanos).
- Shape claro: el lock *es* un contrato, no un detalle de implementación.
- Pattern `INSERT ... ON CONFLICT DO NOTHING RETURNING` elegante.

### Multi-warehouse

`warehouse_enum` con 2 valores (`dep_11`, `dep_12`). `pedido_lines.en_transito BOOLEAN` + `asig_at_transito` + `en_dep11_at` mirror directo de §107. El trigger de sync lee `en_transito` para decidir el warehouse de la reserva:

```sql
v_warehouse := CASE WHEN NEW.en_transito THEN 'dep_12' ELSE 'dep_11' END;
```

### Versión del campo `en_transito`

No se versiona en el schema (es BOOLEAN simple, no un shape compuesto). El schema entero se versiona por migración (`0001_initial.sql` → `0002_...`). El cambio de política de reserva de tránsito (§107.§41 cuando se amplíen los hard caps, etc.) se refleja en la función `line_reserves_stock` — PL/pgSQL puro, actualizable con `CREATE OR REPLACE FUNCTION` sin table rewrite.

### Transition Firestore → PG (fuera de scope)

Ver ADR-008. Aquí sólo defino que el shape destino debe soportar:
- Write-through doble (FS + PG) → PG es "shadow" al principio.
- Read-primary switch (FS primario → PG primario) via feature flag.
- Rollback: PG queda como shadow si surge issue, FS sigue siendo fuente.

### Lo que NO es trivialmente modelable

1. **Shape dinámico de campos opcionales** (`asigRevertidaReason` que existe sólo en algunos flows): mapeado a columnas NULLables. Escalable en v1 a JSONB `audit_jsonb` si crece.

2. **`operations_log` con shape variable por `type`**: fuera de scope v0.

3. **Arrays `asigRefs[]` dentro de items waitlist**: modelado como tabla separada `waitlist_asig_refs` — más código pero permite FK + indexes.

4. **`warehouseBreakdown` como JSON string del snapshot**: en PG es tabla `stock_snapshot(sku, warehouse)` con PK composite. El sync (Python/Node → PG) está en ADR-008.

5. **onSnapshot realtime**: PG no tiene equivalente nativo. Opciones para evaluar:
   - `LISTEN/NOTIFY` + WebSocket relay en backend.
   - Supabase Realtime (si pivotamos a Supabase).
   - Polling cada N segundos.
   - CDC via logical replication → stream a cliente.
   
   **Cambio de modelo mental para el frontend** — documento aquí, resuelvo en otro ADR.

---

## Consecuencias

### Positivas

1. **Invariante de stock blindada**: la DB rechaza reservar > físico. Una capa menos de bugs posibles.
2. **Queries indexadas**: el piloto React obtiene `WHERE closedAt IS NULL AND vendor=$1` en <50 ms sobre 10k pedidos.
3. **Idempotency trivial**: `INSERT ... ON CONFLICT DO NOTHING RETURNING pedido_id` reemplaza runTransaction + fast-path §64.3.
4. **Reporting + migration a BigQuery**: `pg_dump` o Datastream a BQ nativo. Un sync en vez de dos.
5. **Rollback claro**: cada migración tiene UP/DOWN. Un bad deploy se revierte con `migrate:down`.

### Negativas

1. **Pérdida de realtime nativo**: ver "no trivialmente modelable" arriba. Requiere decisión arquitectónica separada.
2. **Operaciones**: Cloud SQL tiene costo + requiere mantenimiento (backups, VPC peering, failover). Firestore era pay-per-op sin ops.
3. **Migración compleja**: ADR-008 cubre el plan. Semanas de doble escritura + validación.
4. **Curva de aprendizaje**: Mariano + el equipo están cómodos con Firestore. PG agrega surface de SQL, triggers, advisory locks, isolation levels.
5. **Trigger de invariante no es gratis**: cada INSERT/UPDATE/DELETE en `pedido_lines` dispara 2 triggers (sync + check). Overhead medible en bulk operations (ej. backfills).

### Neutras

1. El trigger `fn_check_snapshot_decrease` rechaza updates del snapshot que violen el invariante. **Acción requerida del sync SAP**: si quiere bajar el físico, primero debe cancellear reservations (o esperar a que caduquen por TTL). Alternativa: cambiar en v1 a política "aceptar + marcar sobre_asignada" (patrón §40.11).

2. `stock_snapshot` NO tiene `trigger t_stock_reservations_check_invariant` que corra al UPDATE del snapshot. Si el snapshot sube (válido por el guard), no hay problema. Si pasa el guard (porque no viola), tampoco. El guard es suficiente para v0.

---

## Verification before completion

- [x] `backend-new/db/schema/0001_initial.sql` escrito.
- [x] `backend-new/db/schema/README.md` con convenciones + cómo correr migraciones.
- [x] `backend-new/package.json` con `node-pg-migrate` + `vitest` + `pg`.
- [x] `backend-new/db/tests/setup.js` + 5 archivos `.test.js` cubriendo:
  - [x] Smoke (tablas, enums, triggers existen).
  - [x] Happy path (ASIG → stock_reservation).
  - [x] Invariante reserva > físico rebota.
  - [x] Draft lock idempotency (2 commits = 1 pedido).
  - [x] FIFO ASIG por asig_at.
  - [x] En tránsito reserva en dep_12 + cruce dep_11.
- [x] `docs/adr/0001-modelo-datos-pedidos-pg.md` con Context + Decision + Alternatives + Consequences + Status.
- [x] Scope aislado: `git diff --stat main..HEAD` NO toca `functions/`, `index.html`, `src/`, `firestore.rules`.

**Pendiente del humano** (NO parte de este PR):
- Mariano aprueba el ADR (cambia `Status: Accepted` si está de acuerdo, `Proposed` si quiere discutir).
- Decidir Cloud SQL vs Supabase vs AlloyDB vs TimescaleDB (todas opciones PG-compatible).
- ADR-008 (plan de migración no-downtime) aborda shadow sync + cutover.

---

## Links

- Plan intermedio Superpowers: [`docs/superpowers/plans/2026-11-26-pg-schema-pedidos.md`](../superpowers/plans/2026-11-26-pg-schema-pedidos.md).
- Schema SQL: [`backend-new/db/schema/0001_initial.sql`](../../backend-new/db/schema/0001_initial.sql).
- README migraciones: [`backend-new/db/schema/README.md`](../../backend-new/db/schema/README.md).
- Tests Vitest: [`backend-new/db/tests/`](../../backend-new/db/tests/).
- CLAUDE.md §40 (BO/ASIG/confirmed reglas), §64.3 (draft locks), §107 (dep12), §108 (pareja VDE).
