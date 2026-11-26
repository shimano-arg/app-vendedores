# ADR-0016 — Wiring dual-write Firestore → PG inline en commitPedidoCore

- **Status**: Proposed
- **Fecha**: 2026-11-26
- **Rama**: `feat/s12-dual-write-wiring`
- **Decisor**: Mariano (pendiente — Phase 2 Stack S-12)
- **Supersedes**: parcialmente a `docs/superpowers/plans/2026-11-26-dual-write-pedidos.md` (sección "trigger onDocumentWritten"). Los helpers `transformPedidoToPg` + `comparePedidoParity` permanecen vigentes.

## Contexto

S-10 shipeó los helpers puros + schema PG v0 aplicado a `crm-staging`. Falta wiring que dispare la escritura a PG cuando un pedido se persiste exitosamente en Firestore (`commitPedidoCore`).

Hay tres opciones arquitectónicas:

### A — Import directo desde `backend-new/`

Reusar el backend TS (`backend-new/src/pedidos/repo.ts` etc.) importándolo desde `functions/core/commit-pedido-core.js`.

**Problemas**:

- `backend-new/` es TypeScript; `functions/` es ESM JavaScript puro con JSDoc annotations.
- Firebase Functions v6 (`firebase-functions@^6.0.1`) soporta TS pero requiere `tsc` pipeline en el build. El root `functions/` hoy usa `"main": "index.js"` sin build step.
- Mezclar runtimes puede causar duplicación de instancias Firestore Admin SDK (dos `getFirestore()` paralelos → race condition potencial).
- Overhead de `require('../backend-new/...')` desde `functions/` cross-package no está testeado.

**Veredicto**: posible pero costoso. Requiere build pipeline nuevo + tsconfig específico de `functions/` + ajustes en CI. Fuera de scope de S-12.

### B — Duplicar lógica en `functions/core/dual-write-pg.js` (CJS puro)

Escribir un módulo CJS standalone en `functions/core/` con SQL inline y dep directa `pg@^8.13.0`.

**Problemas**:

- `functions/` ya está marcado `"type": "module"` en `package.json`. Mezclar CJS + ESM en el mismo paquete genera warnings de interop (puede romper tree-shaking futuro).
- Rompe la convención `src/pure/` + mirror `functions/core/` (§57 CLAUDE.md) que mantiene lógica cliente+servidor sincronizada.

**Veredicto**: funcional pero rompe convención del repo.

### C — Helper puro en `src/pure/` + módulo servidor ESM con `pg` directo ✅

Patrón idéntico al resto del repo:

- `src/pure/dual-write-pg-helpers.js` — pure functions: SQL building, parameter ordering, validation.
- `functions/core/dual-write-pg.js` — módulo ESM servidor; encapsula `pg.Pool` singleton + fire-and-forget + enqueue retry. Importa `transformPedidoToPg` (S-10) + los helpers puros nuevos.

**Ventajas**:

- Respeta §57 (mirror cliente/servidor para la lógica pura).
- Tests unit triviales con mock `pg.Pool` en memoria.
- No requiere build pipeline nuevo; integra con `node build.js` existente.
- `pg` solo se agrega en `functions/package.json` (no contamina el bundle del cliente).
- Reusa `transformPedidoToPg` S-10 sin duplicación.

**Desventajas**:

- El SQL inline en `functions/core/dual-write-pg.js` duplica parcialmente lo que haría el `PedidoRepository` de `backend-new/`. Si el schema PG cambia, hay dos lugares que ajustar. **Mitigación**: tests de contract comparan output de `transformPedidoToPg` contra el shape de los INSERT; cualquier drift explota en test.

## Decisión

**Opción C**.

Archivos creados en este PR:

- `src/pure/dual-write-pg-helpers.js` + mirror `functions/core/dual-write-pg-helpers.js` (SQL building puro).
- `functions/core/dual-write-pg.js` (módulo servidor con `pg.Pool` + fire-and-forget).
- Wiring en `functions/core/commit-pedido-core.js` (2 call sites post-commit).

Archivos modificados:

- `functions/package.json` — agregar `pg@^8.13.0`.
- `firestore.rules` — colección `dual_write_pending` solo admin SDK (`allow read, write: if false`).

## Consecuencias

### Positivas

- Latencia mínima entre Firestore commit y PG replicate (sin trigger intermediario).
- Fire-and-forget garantiza que PG caído no rompe el commit (Firestore sigue siendo fuente de verdad).
- Idempotente por `pedidoId` (DELETE+INSERT atómico con cascade FK).
- Flag OFF por default — zero riesgo en prod al mergear.

### Negativas

- `commit-pedido-core.js` gana 2 call sites nuevos (chicos, fire-and-forget).
- Si se agregan tablas PG nuevas (ej. `revision_waitlist`), habrá que crear otro módulo servidor (no es `pg.Pool` singleton reutilizable para N tablas sin refactor).
- Reintentos manuales via `dual_write_pending` requieren un script/CF aparte (no forma parte de este PR; queda como backlog).

### Seguridad

- `pg.Pool` carga password de Secret Manager vía env `PG_PASSWORD` (compatible con pattern Cloud SQL proxy).
- Nunca se loguea el password; solo `errorMessage` (que puede incluir host/port pero no credenciales).
- Rules `dual_write_pending` cerradas — cliente no puede leer qué pedidos fallaron.

## Alternativas descartadas en el camino

- **Pub/Sub topic + CF subscriber**: overkill para v0. Si el throughput sube (>100 pedidos/s), migrar a trigger onDocumentWritten + Pub/Sub sería la opción. Hoy ~10 pedidos/hora.
- **Prepared statements vs query strings**: `pg` client acepta ambos. Elegí query strings con parámetros `$1, $2...` (prevención SQL injection + mejor legibilidad del SQL inline).
- **Transacción por líneas (N txs chicas)**: rechazado. Un pedido = 1 transacción PG. Simplifica idempotencia y rollback.

## Verificación

- `tests/functions/dual-write-commit-pedido.test.js` — 6 tests unit.
- `backend-new/db/tests/dual-write-integration.test.js` — 4 tests integration contra `crm-staging`.
- Post-merge: `operations_log` con `type='dual_write_ok|failed|skipped_*'` documenta cada ejecución.
