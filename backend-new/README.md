# backend-new — Shimano CRM

Backend TypeScript/Node del CRM Shimano (ADR-014). Data layer + piloto solo-lectura ADR-013.

**Independiente** del `functions/` raíz: su propio `package.json`, su propio `node_modules/`, su propio ciclo de deploy. Durante la transición (ADR-008) conviven lado a lado.

## Stack

- **Node 22** + **TypeScript 5** strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- **Hono** — framework HTTP ligero, soporta Cloud Functions Gen 2 + Cloud Run con el mismo adapter.
- **Zod** — schemas por operación; fuente única cliente↔servidor.
- **Kysely** — query builder tipado sobre `pg`. No ORM.
- **Firebase Admin SDK** — solo lectura legacy (roles, app_config) durante la transición.
- **Vitest** + **testcontainers** (`postgres:16-alpine`) para integration tests.

## Estructura

```
backend-new/
  apps/api/              # Hono entry + Cloud Functions Gen 2 wrapper
    index.ts
    wrapper-firebase.ts
    routes/
      health.ts
      stock.ts
      pedidos.ts
  domains/
    stock/
      get-breakdown.ts       # pure fn + integration test
      get-breakdown.test.ts
    pedidos/
      get-pedidos-by-client.ts
      get-pedidos-by-client.test.ts
  infra/
    db/                       # Kysely pool + repos
      pool.ts
      schema.ts
      repos/
        stock-repo.ts
        pedidos-repo.ts
    firestore/
      admin.ts
    secrets/
      manager.ts
  shared/
    contracts/                # Zod schemas (fuente única)
      common.ts
      get-stock.ts
      get-pedidos.ts
    errors/
      business-errors.ts
  tests/
    contract/                 # Repo output ↔ Zod schema
      stock-contract.test.ts
      pedidos-contract.test.ts
  db/                         # Migrations SQL (ADR-001) — ya existente
    schema/
      0001_initial.sql
```

## Instalación local

**No instalar aún al root del repo** — este paquete es independiente. Cuando quieras correr los tests:

```bash
cd backend-new
npm install
```

Si falla por red inestable (CLAUDE.md §1), reintentar o pedir `--prefer-offline`.

## Correr tests

```bash
# Contract tests (sin DB — fast):
cd backend-new
npx vitest run tests/contract shared

# Integration tests (requieren Docker o DATABASE_URL):
npx vitest run domains

# Todo:
npm test
```

Los integration tests **se saltan automáticamente** si no hay Docker ni `DATABASE_URL` set (patrón tolerante §11). No rompen la build.

## Type check

```bash
npm run typecheck
```

Strict total: `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`.

## Rutas expuestas

### `GET /health`

Readiness probe. 200 OK si el pool PG responde `SELECT 1`. 503 si la DB no es alcanzable.

### `GET /api/v1/stock/:sku`

Breakdown v0 del SKU (ADR-001 §39). Lee la VIEW `v_stock_breakdown`.

Request:
```
GET /api/v1/stock/CUDC201HG
```

Response 200:
```json
{
  "ok": true,
  "data": {
    "sku": "CUDC201HG",
    "fisicoDep11": 10,
    "transitoDep12": 0,
    "backorderApp": 2,
    "asignadasDep11": 3,
    "confirmadasDep11": 1,
    "asignadasDep12": 0,
    "confirmadasDep12": 0,
    "reservadasDep11": 4,
    "libreDep11": 6,
    "_version": 1
  }
}
```

Errors: `STOCK_SKU_NOT_FOUND` (404), `VALIDATION_ERROR` (400), `DATABASE_UNAVAILABLE` (503).

### `GET /api/v1/pedidos?cardCode=...&stage=open&limit=50&cursor=...`

Lista de pedidos slim de un cliente. Keyset pagination por `(created_at DESC, id DESC)`.

Response 200:
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "p_abc",
        "orderNumber": 1002,
        "clientCardCode": "C001",
        "clientName": "cliente A",
        "stage": "open",
        "origen": "cpst",
        "createdAt": "2026-11-26T11:00:00.000Z",
        "confirmedAt": "2026-11-26T12:00:00.000Z",
        "netAmountArs": 4050,
        "lines": [
          { "sku": "SKU-X", "state": "confirmed", "qty": 3, "qtyOpen": 3, "priceArs": 1500, "discountPercent": 10 },
          { "sku": "SKU-Y", "state": "BO", "qty": 1, "qtyOpen": 1, "priceArs": 500, "discountPercent": 0 }
        ]
      }
    ],
    "pageInfo": {
      "nextCursor": "eyJpc28iOiIy...",
      "hasMore": false
    }
  }
}
```

## Contratos Zod — fuente única

**Importante**: el frontend React (ADR-013) y las rutas Hono importan los MISMOS schemas desde `shared/contracts/`. Tipos end-to-end con validación runtime a ambos lados (§68 patrón).

## Idempotencia (futuro)

Cuando se abran mutaciones (`POST /pedidos` en etapas siguientes del piloto):

```ts
POST /api/v1/pedidos
{
  "idempotencyKey": "draft_...",
  ...payload
}
```

El handler valida contra `pedido_draft_locks` (tabla del schema v0):

```sql
INSERT INTO pedido_draft_locks (draft_id, pedido_id, ...)
VALUES (...)
ON CONFLICT (draft_id) DO NOTHING RETURNING pedido_id;
```

Si no devuelve filas → el lock existía → `SELECT pedido_id FROM pedido_draft_locks WHERE draft_id=$1` → devolver 200 idempotente.

TODOs marcados en `apps/api/routes/pedidos.ts` + `shared/contracts/common.ts`.

## Deploy (futuro — zero deploy en este PR)

```bash
cd backend-new
npm install
npm run build        # tsc --noEmit (verificación)
# Deploy via firebase.json root:
# firebase deploy --only functions:crmApiCF
```

Secrets a configurar (Secret Manager):

```bash
firebase functions:secrets:set DATABASE_URL
```

VPC connector para Cloud SQL Private IP: TODO ADR-008.

## Decisiones

Ver plan en [`docs/superpowers/plans/2026-11-26-backend-data-layer.md`](../docs/superpowers/plans/2026-11-26-backend-data-layer.md).

Resumen de alternativas rechazadas:

- **Prisma**: fuerza ORM full-featured; maneja mal triggers PG complejos (schema v0 tiene 3 críticos). ADR-014 lo descarta.
- **Drizzle**: menos maduro con triggers/enums PG.
- **pg sin query builder**: pierde tipado.
- **Fastify**: más pesado + menos soporte serverless maduro que Hono.
- **tRPC**: postergado — exige que cliente y servidor compartan deps; hoy convivimos con vanilla legacy.

## Referencias

- ADR-001 schema PG: `docs/adr/0001-modelo-datos-pedidos-pg.md`.
- ADR-013 piloto: `docs/adr/0013-piloto-solo-lectura-stock-pedidos.md`.
- ADR-014 stack: `docs/adr/0014-backend-typescript-node-modular.md`.
- CLAUDE.md §7 (core puro + wrapper), §57 (pure + mirror), §68 (mensajes humanos), §89 (server resuelve), §90 (checklist VDE).
