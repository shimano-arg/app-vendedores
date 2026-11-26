# Plan — Backend TypeScript data layer (ADR-014 piloto ADR-013)

- **Fecha**: 2026-11-26.
- **Rama**: `feat/s10-backend-data-layer`.
- **Base**: `origin/main` + cherry-picks `feat/s10-pg-schema-adr001` (schema 0001) y `docs/s10-adrs-accepted` (ADR-001/004/013/014/015).
- **Autor**: backend-architect.
- **Supersede**: nada. Primer entry-point TS del repo.

## Contexto

ADR-014 define el stack **Hono + Zod + Kysely + Node 22 + TypeScript 5 strict**.
ADR-013 define el piloto solo-lectura con 2 operaciones:
`getStockBreakdown(sku)` y `getPedidosByClient(cardCode, filters)`.
El schema PG ya está en `backend-new/db/schema/0001_initial.sql` (ADR-001).

Este PR construye la **capa de acceso a datos** y las **2 rutas HTTP** del piloto.
No incluye mutaciones (sólo diseña el pattern de idempotency en comentarios).
No toca `functions/`, `index.html`, `src/`, `firestore.rules`.

## Objetivos

1. Contratos Zod como **fuente única cliente↔servidor** para las 2 operaciones.
2. Repos SQL explícitos con Kysely, tipados contra el schema SQL.
3. Hono app con 3 rutas (`/health`, `/api/v1/stock/:sku`, `/api/v1/pedidos`) + adapter Cloud Functions Gen 2.
4. Tests en 3 niveles: unit (sin DB), contract (schema Zod ↔ repo shape), integration (testcontainers PG real, skip si no hay Docker).
5. TS strict total (`strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
6. Pattern de idempotency documentado para mutaciones futuras (comentarios + tabla `pedido_draft_locks` ya existente).

## No-objetivos

- Autenticación (callable Firebase valida del lado del wrapper; aquí el core recibe `caller` como input).
- Mutaciones (crear/editar/cancelar pedidos) — fuera del piloto ADR-013.
- Firestore writes (solo lectura legacy via Admin SDK en capa `infra/firestore/`, pattern para la transición ADR-008).
- Deploy real (zero deploy; PR de diseño).
- Observabilidad (pino / OpenTelemetry) — scope del siguiente PR.

## Estructura del deliverable

Ver prompt original. Resumen:

```
backend-new/
  apps/api/                      # Hono entry + Cloud Functions wrapper + 3 routes
  domains/                       # getStockBreakdown + getPedidosByClient (lógica pura)
  infra/
    db/                          # Kysely + pg Pool + schema types + 2 repos
    firestore/                   # Admin SDK wrapper (legacy read)
    secrets/                     # Secret Manager wrapper
  shared/
    contracts/                   # Zod schemas por operación (fuente única)
    errors/                      # catálogo de errorCodes + mensajes humanos §68
  tests/
    contract/                    # repo output ↔ Zod schema
  package.json                   # independiente (no toca el root)
  tsconfig.json                  # strict
  vitest.config.ts
  README.md
```

## Decisiones técnicas

### Kysely vs alternativas

Elegido Kysely sobre:

- **Prisma**: ORM full-featured pero fuerza codegen, migra mal con triggers PG complejos (schema v0 tiene 3 triggers críticos + 1 VIEW) y oculta la query. ADR-014 lo rechaza explícitamente.
- **Drizzle**: query builder similar a Kysely pero con ergonomía schema-first menos madura para PG triggers / enums. Menor adopción en producción en el momento.
- **pg-native + plantillas SQL**: máxima simpleza, cero abstracción. Perdido el tipado del resultado → cada query re-escribe shape manualmente. Sacrifica safety que es la motivación principal de ADR-014.
- **Knex**: query builder clásico pero sin tipos TS de primera clase (requiere `knex-stringcase` + types manuales). Kysely nació TS-first.

Kysely gana porque:

1. **Query builder tipado**, no ORM — el SQL sale explícito, cada JOIN y WHERE se ve.
2. **Types generados desde el schema SQL** (via `kysely-codegen`) o escritos a mano (lo que hacemos en v0 por simplicidad).
3. **Zero magic**: una query Kysely == 1 query SQL. Sin lazy loading, sin N+1 silencioso.
4. **Playing well with triggers**: los triggers del schema v0 corren server-side y Kysely no tiene que saber nada de ellos; cada `INSERT INTO pedido_lines` dispara el trigger de sync a `stock_reservations` sin intervención del cliente.

### Shape de los contratos Zod

Dos principios:

1. **Input** del cliente valida parámetros simples (SKU, cardCode, filtros). Devuelve errores human-readable con §68.
2. **Output** describe el shape SLIM que la UI del piloto necesita. No se expone todo el pedido — sólo los campos de ADR-013 (orderNumber, stage, createdAt, confirmedAt, netAmountArs, lines resumidas).

Esto permite que el pedido real en PG tenga 30+ columnas (algunas sensibles como `transferido_sap`, `closed_reason`), pero el output que llega al mobile sea 1/5 del tamaño y 100% público.

### Idempotencia (mutaciones futuras — NO en este PR)

Pattern documentado en `shared/contracts/common.ts`:

```ts
export const IdempotencyKey = z.string().min(10).max(100);
```

Cada mutación futura (ej. `POST /api/v1/pedidos`) incluye `idempotencyKey` en el payload. La CF valida contra `pedido_draft_locks` (tabla ya existente, schema 0001) con el patrón:

```sql
INSERT INTO pedido_draft_locks (draft_id, pedido_id, ...) VALUES (...)
ON CONFLICT (draft_id) DO NOTHING RETURNING pedido_id;
```

Si no devuelve filas, el lock existía → SELECT del pedido pre-existente.

En este PR dejamos comentarios TODO en los lugares donde van a vivir los handlers de mutación.

### Tests

Tres niveles:

1. **Unit**: pure functions, sin DB, mocks mínimos (fast). Correr siempre.
2. **Contract**: verificar que el output del repo cumple el schema Zod correspondiente. No requieren DB real — usan fixtures tipados. Corren siempre.
3. **Integration**: testcontainers con `postgres:16-alpine`. Correr migrations desde `backend-new/db/schema/0001_initial.sql`, insertar fixture, verificar shape del repo. Usan `test.skipIf(!dockerAvailable)` para tolerar entornos sin Docker (CI por default lo tiene, dev local no siempre).

### TS strict knobs

```json
{
  "strict": true,
  "noUncheckedIndexedAccess": true,       // obliga a guards sobre arr[i]
  "exactOptionalPropertyTypes": true,     // { x?: string } ≠ { x: string | undefined }
  "noImplicitOverride": true,
  "noFallthroughCasesInSwitch": true,
  "forceConsistentCasingInFileNames": true
}
```

## Workflow del PR

1. Agregar `backend-new/package.json` nuevo con workspace independiente.
   - NO instalar deps al repo root.
   - npm install solo se hace si CI lo pide; no es parte del PR en sí.
2. Agregar `backend-new/tsconfig.json` + `vitest.config.ts`.
3. Agregar `shared/contracts/*.ts`.
4. Agregar `infra/db/{pool.ts, schema.ts, repos/*.ts}`.
5. Agregar `domains/stock/get-breakdown.ts` + test.
6. Agregar `domains/pedidos/get-pedidos-by-client.ts` + test.
7. Agregar `apps/api/{index.ts, wrapper-firebase.ts, routes/*.ts}`.
8. Agregar `tests/contract/*.test.ts`.
9. Agregar `README.md` + `.gitignore`.
10. 1 commit atómico. Push a `feat/s10-backend-data-layer`. `gh pr create`.

## Gate ejecutable (al cerrar)

```
cd backend-new
# Install opcional (humano decide si corre)
# npm install

# Si install corrió, verificar tipos:
# npx tsc --noEmit
# vitest run tests/ domains/ shared/
```

Como en este PR no instalamos deps al CI del root, no hay gate automático. Humano revisa diff.

## Rollback

Delete `backend-new/apps/`, `backend-new/domains/`, `backend-new/infra/`, `backend-new/shared/`, `backend-new/tests/`. Dejar `backend-new/db/` intacto (schema 0001 es ADR-001 separado, mergeable aparte).

## Links

- ADR-013: `docs/adr/0013-piloto-solo-lectura-stock-pedidos.md`.
- ADR-014: `docs/adr/0014-backend-typescript-node-modular.md`.
- ADR-001 schema: `backend-new/db/schema/0001_initial.sql`.
- CLAUDE.md §7 (core puro + wrapper), §57 (pure + mirror), §68 (mensajes humanos), §89 (server resuelve), §90 (checklist VDE).
