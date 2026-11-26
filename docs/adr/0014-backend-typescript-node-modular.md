# ADR-0014: Backend TypeScript/Node modular, migración gradual de Functions

- **Status**: Accepted (2026-11-26).
- **Decididor**: Mariano (owner técnico).
- **Fecha decisión**: 2026-11-26 11:23 ART.
- **Supersede**: ninguno formal. Nueva política sobre las Cloud Functions existentes (CLAUDE.md §7).
- **Relacionado**: ADR-001 (modelo PG), ADR-004 (frontend React), ADR-008 (migración), ADR-013 (piloto solo lectura), ADR-015 (CWV criterios).

## Contexto

Las Cloud Functions actuales viven en `functions/index.js` + `functions/core/*.js` (JS + JSDoc types + `firebase-functions` v6). Son ~60 CFs entre callables, triggers Firestore, scheduled y HTTPS. El pattern "core puro + wrapper Firebase" de CLAUDE.md §7 ya separa lógica de infra pero:

- Los tests usan mocks de Firestore hand-rolled (patrón `strict mock` §58).
- No hay types compartidos cliente↔servidor — cada payload se replica manualmente.
- Dependencias entre CFs están implícitas (import cross-files sin boundary explícito).
- El callable → PG flow nuevo necesita queries SQL, transacciones y connection pooling — ergonómicamente penoso en el estilo actual.

## Decisión

El backend nuevo del CRM se construye como **servicio TypeScript/Node 22 modular** bajo `backend-new/` (nuevo directorio). Migración gradual de las Functions existentes **CF por CF** cuando cada una se re-implementa contra PostgreSQL o cuando se le agrega una pantalla React (ADR-013).

### Stack

- **Runtime**: Node 22 (match al Cloud Functions runtime).
- **Lenguaje**: TypeScript 5 (strict, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`).
- **Framework HTTP**: **Hono** (ligero, tree-shakeable, soporta Cloud Functions Gen 2 y Cloud Run en el mismo adapter).
- **Validación de payload**: **Zod** (schemas por operación, type inference, compat con tRPC si más adelante vale).
- **PG client**: `pg` + **Kysely** como query builder tipado (no ORM full — menos magia, SQL explícito).
- **Migrations**: ver ADR-001 (`node-pg-migrate` o equivalente definido por el agente DB).
- **Tests**: Vitest + `testcontainers-node` contra PG real.
- **Deploy**: Cloud Functions Gen 2 (mismo que el resto) o Cloud Run (reserva para futuro).

### Estructura modular

```
backend-new/
  apps/
    api/                 # entry HTTP (Hono)
      routes/
        stock.ts         # GET /stock/:sku
        pedidos.ts       # GET /pedidos?cardCode=...
      index.ts           # setup + registry de handlers
      wrapper-firebase.ts # adapter CF Gen 2
  domains/
    stock/               # lógica de dominio pura (no I/O)
      breakdown.ts       # port del src/pure/stock-breakdown.js
      breakdown.test.ts
    pedidos/
    reservas/
  infra/
    db/                  # Kysely client + repos
      schema.ts          # types generados desde schema SQL
      pool.ts            # connection pool
    firestore/
      admin.ts           # Admin SDK wrapper (lectura legacy)
    secrets/
      manager.ts         # Secret Manager wrapper
  shared/
    contracts/           # Zod schemas por operación — fuente única
      get-stock.ts
      get-pedidos.ts
```

### Contratos (Zod) como fuente única cliente↔servidor

```ts
// backend-new/shared/contracts/get-stock.ts
import { z } from 'zod';

export const GetStockInput = z.object({
  sku: z.string().min(1).max(50),
});

export const GetStockOutput = z.object({
  sku: z.string(),
  fisicoDep11: z.number().int().nonnegative(),
  libre: z.number().int().nonnegative(),
  // ... (match al shape v8 del breakdown)
});

export type GetStockInput = z.infer<typeof GetStockInput>;
export type GetStockOutput = z.infer<typeof GetStockOutput>;
```

El frontend React importa estos schemas via `backend-new/shared/contracts/*` → compartido con type-safety end-to-end + validación runtime en ambos extremos.

### Idempotencia

Cada mutación (futuro — no en el piloto) requiere `idempotencyKey` en el payload. El backend valida contra tabla `idempotency_keys` (PG) antes de ejecutar. Pattern:

```ts
app.post('/pedidos', async (c) => {
  const payload = PostPedidoInput.parse(await c.req.json());
  const existing = await repo.findByIdempotencyKey(payload.idempotencyKey);
  if (existing) return c.json(existing, 200);
  // ... crear
});
```

En el piloto solo lectura (ADR-013), idempotencia no aplica — pero el pattern queda establecido para cuando se abra escritura.

### Migración gradual de Functions existentes

**NO se reescribe todo el backend actual.** Las Functions existentes siguen vivas. Se migra una CF a la vez, cuando:

1. La feature de esa CF se re-implementa en React (ADR-013 siguientes etapas).
2. La CF pasa a necesitar queries PG (no solo Firestore).
3. Aparece un bug grande en la CF que justifica el rewrite.

Convivencia: `backend-new/` corre en paralelo a `functions/` durante la transición. Ambos pueden leer/escribir el mismo Firestore. La doble escritura PG↔Firestore (ADR-008) es el puente para pedidos cuando se migren.

### Deploy

- `backend-new/` deploya como **Cloud Function Gen 2** adicional (`crmApiCF` en `southamerica-east1`) usando el mismo `firebase.json` del proyecto.
- Secret Manager vía `firebase functions:secrets:set DATABASE_URL`.
- VPC Connector para conectar a Cloud SQL Private IP (ver PENDIENTE_HUMANO guía staging).

### Observabilidad

- `structured-log` con `pino` → exporta a Cloud Logging con shape JSON.
- Error tracking: Sentry opcional (ADR aparte si se activa).
- Métricas: Cloud Monitoring built-in + custom metrics con `@google-cloud/opentelemetry-cloud-trace-exporter`.

## Consecuencias

### Bueno

- Types end-to-end cliente↔servidor via Zod + TypeScript.
- Queries PG explícitas (Kysely) sin magia de ORM.
- Tests contra PG real (testcontainers) — sin mocks hand-rolled.
- Hono es 10× más chico que Express + soporta serverless runtimes.
- Zod schemas se validan en ambos extremos → payloads inválidos fallan rápido con mensaje útil (§68).

### Malo

- Node 22 + TS 5 requieren Node install en CI (ya lo tiene).
- `testcontainers` requiere Docker en CI (GitHub Actions lo tiene built-in).
- Dos backends (CFs legacy en `functions/` + `backend-new/`) durante la transición — surface de bugs cross-runtime.
- Deploy duplica: `cd functions && firebase deploy` + `cd backend-new && firebase deploy`. Mitigable con workspace o pipeline unificado.

### Lo que NO cambia

- `functions/` existente sigue 100% funcional durante la transición.
- Firestore rules (siguen siendo fuente de verdad para permisos de lectura cliente→Firestore directo).
- SAP integration (vive en `functions/core/sap-*.js`, se migra en último lugar).

## Alternativas evaluadas

1. **Seguir con JS + JSDoc + firebase-functions v6**. Rechazado — Zod + TS end-to-end es más robusto y el equipo ya invierte en TS en el frontend (ADR-004).
2. **Fastify** en vez de Hono. Rechazado — Fastify es más pesado + no tree-shakeable + tooling de serverless más maduro en Hono (soporta Cloud Functions, Cloud Run, Deno, Bun con el mismo código).
3. **tRPC end-to-end** (sin HTTP tradicional). Postergado — tRPC exige que cliente y servidor compartan deps. Posible en el futuro cuando la convivencia con el mundo vanilla legacy termine.
4. **Prisma como ORM**. Rechazado — SQL explícito con Kysely es más auditable, no genera ni abstrae las queries, y hace más fácil razonar sobre performance. Ver también §32-§40 (invariantes de stock dependen de SQL preciso).
5. **Deno / Bun** como runtime. Rechazado — Firebase Functions Gen 2 soporta oficialmente Node. Deno/Bun serían un gradient de riesgo innecesario.

## Verification

- `tsconfig.json` con `strict: true` + `exactOptionalPropertyTypes: true`.
- Audit test `backend-new/tests/contract/zod-schemas-coverage.test.ts`: cada ruta expone un schema de entrada y uno de salida.
- CI gate: `cd backend-new && npm run build && npm test` falla el PR.
- Cada CF migrada debe tener test E2E Playwright que la invoque y valide response shape.

## Rollback

- Deploy de `crmApiCF` puede revertirse con `gcloud functions delete crmApiCF --region=southamerica-east1`.
- Las pantallas React que lo consumen (ADR-013) muestran mensaje "servicio no disponible" (§68) y redirigen a la app actual.
- `functions/` legacy no se ve afectada por rollback del backend nuevo.
