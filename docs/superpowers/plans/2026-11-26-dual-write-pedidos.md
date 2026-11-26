# Plan — Doble escritura Firestore → PostgreSQL para `pedidos`

**Fecha**: 2026-11-26
**Decisor**: Mariano
**Autor**: software-architect (branch `feat/s10-dual-write-design`)
**Status**: Draft — diseño + código behind flag `OFF` por default. **Nada se activa en producción.**
**Pre-requisitos**:
- ADR-001 `docs/adr/0001-modelo-datos-pedidos-pg.md` (Accepted 2026-11-26).
- ADR-008 `docs/adr/0008-migracion-no-downtime.md` (Proposed, firma pendiente de Mariano).
- ADR-009 `docs/adr/0009-feature-flags.md` (Accepted 2026-11-25).
- ADR-014 (backend TS/Node modular — próximo sprint).

---

## Objetivo

Diseñar e implementar la **capa de doble escritura** que replica cada mutación de `/pedidos` (Firestore) a `pedidos` / `pedido_lines` / `stock_reservations` en PostgreSQL. Habilitar el patrón recomendado por ADR-008 opción B con flags default `OFF`. **Ningún byte productivo cambia de comportamiento al mergear este PR.**

### Qué resuelve

1. Habilitar el shadow sync Firestore → PG descrito en ADR-008 §Opción B paso 1.
2. Dejar listo el pure helper `transform-pedido-to-pg.js` que mapea el shape Firestore al shape PG (`pedidos` cabecera + `pedido_lines[]` + `stock_reservations[]`).
3. Dejar listo el pure helper `compare-pedido-parity.js` para el audit nocturno (ADR-008 §paso 2).
4. Scaffolding de la Cloud Function trigger (`onDocumentWritten` sobre `pedidos/{pedidoId}`) deployada **DESHABILITADA** (sin export en `functions/index.js`) + scheduled CF del parity check **deshabilitada**.
5. Script read-only `scripts/audit/W_dual_write_health.cjs` para contar divergencias ANTES de activar.
6. Feature flags `dual_write_pedidos_enabled` + `read_from_pg_pedidos_enabled` ambos default `false`.

### Qué NO resuelve (scope out)

- Ingesta del backfill histórico de los ~710 pedidos abiertos actuales (va en un paso aparte, post buy-in de Mariano sobre este plan).
- Flip real del flag a `true` en producción (va en S-10.3 una vez acordada ventana).
- Cambio en el shape de reads client-side (`index.html` sigue leyendo Firestore sin excepción).
- Migración definitiva (apagar `/pedidos` Firestore) — es S-10.5.
- `revision_waitlist`, `ingresos_reparto`, `operations_log` — scope sólo pedidos + líneas + reservas.

---

## Diagrama de flujo

### Write path (flag ON, estado objetivo S-10.3)

```
┌─────────────────┐
│ VDE / admin     │
│ confirma pedido │
└────────┬────────┘
         │ callable commitPedidoCF (Cloud Function existente)
         ▼
┌────────────────────────────────────────────┐
│ commitPedidoCore (hoy §64 + §58 tx-safe)   │
│  1. runTransaction Firestore               │
│  2. tx.set(pedidos/{id})                   │
│  3. tx.update(revision_waitlist stage)     │
│  4. tx.set(pedido_draft_locks/{draftId})   │
└────────┬───────────────────────────────────┘
         │ Firestore commit OK
         ▼
┌────────────────────────────────────────────┐
│ Trigger onDocumentWritten `pedidos/{id}`   │
│ onPedidoWriteToPg (DESHABILITADA en v0)    │
└────────┬───────────────────────────────────┘
         │ si `dual_write_pedidos_enabled === true`
         ▼
┌────────────────────────────────────────────┐
│ transformPedidoToPg (pure)                 │
│  Firestore doc → {                         │
│    pedido: {id, orderNumber, ...},         │
│    lines: [{pedidoId, lineIndex, ...}],    │
│    reservations: [{pedidoId, ..., qty}],   │
│  }                                         │
└────────┬───────────────────────────────────┘
         │ rows PG
         ▼
┌────────────────────────────────────────────┐
│ PG client (capa P1.3, no-op en v0)         │
│  BEGIN; INSERT/UPDATE pedidos; ...         │
│  COMMIT;                                    │
└────────────────────────────────────────────┘
```

### Read path (flag ON, S-10.4 post 7d de paridad)

```
┌─────────────────┐
│ UI / Planner    │
│ list pedidos    │
└────────┬────────┘
         │
         ▼
   ¿read_from_pg_pedidos_enabled?
        ┌────────┴────────┐
        │ false (default) │ true (post-cutover)
        ▼                 ▼
┌───────────────┐   ┌───────────────┐
│ Firestore     │   │ PG via API    │
│ onSnapshot    │   │ REST read-only│
│ (hoy)         │   │ fail-open a FS│
└───────────────┘   └───────────────┘
```

---

## 5 fases (ADR-008 pattern)

### Fase 0 — PRE-flag OFF (este PR, S-10.3-base)

**Estado**: `dual_write_pedidos_enabled = false`, `read_from_pg_pedidos_enabled = false`. Nada corre en prod. Código listo detrás del flag.

**Entregables del PR**:
1. Feature flags nuevos en `app_config/feature_flags` (documentación + defaults `false`).
2. Pure helpers `transform-pedido-to-pg.js` + `compare-pedido-parity.js` + mirrors §57.
3. Cloud Function stub `on-pedido-write-to-pg.js` deployada **DESHABILITADA** (no export).
4. Scheduled CF `nightly-parity-check.js` deployada **DESHABILITADA** (no export).
5. Tests unit + audit + functions con 10+ cada uno + sync test §57.
6. Script `scripts/audit/W_dual_write_health.cjs` (read-only).

**Métrica de cierre Fase 0**: PR mergeado + Playwright E2E vs dev confirma que `commitPedidoCF` sigue devolviendo lo mismo y 0 docs aparecen en PG.

**Ventana de observación**: 7+ días post-merge sin que se active el flag. Permite que el bundle propague a todos los VDE/admin (SW stale §99).

---

### Fase 1 — Shadow writes (S-10.3.1, paso 1 ADR-008)

**Trigger**: Mariano aprueba Fase 0 + schema PG ya corriendo en Cloud SQL (fuera de scope de este PR).

**Qué se activa**: `dual_write_pedidos_enabled = true` (toggle Panel Control Mariano-only). `read_from_pg_pedidos_enabled` sigue `false`.

**Qué pasa en prod**:
1. Cada write a `pedidos/*` en Firestore dispara el trigger.
2. Trigger lee flag, transforma el doc, persiste en PG.
3. Si PG falla (red, constraint): log en `operations_log` type=`dual_write_write_failed`, pedido Firestore queda intacto (fail-open §77/§89).
4. Fase lectura **NO cambia**. La app sigue leyendo Firestore 100%.

**Ventana de observación**: mínimo **7 días consecutivos** con parity audit nocturno OK (sin divergencias). ADR-008 §paso 2.

**Métrica de cierre Fase 1 → 2**:
- Parity check nocturno reporta **0 divergencias** 7 días seguidos.
- Log `dual_write_write_failed` menor al **0.1% de writes**.
- Latencia extra del trigger medida en Cloud Monitoring < 500ms p99.

---

### Fase 2 — Nightly parity audit (S-10.3.2, paso 2 ADR-008)

**Trigger**: flag `dual_write_pedidos_enabled` ya en `true` en Fase 1.

**Qué se activa**: scheduled CF `nightly-parity-check.js` (3 AM ART, `onSchedule('every 24 hours')`). Default ejecuta en modo `--dry-run=false, write-report=true`.

**Qué hace el audit**:
1. Query Firestore: todos los pedidos abiertos (`closedAt == null`).
2. Para cada uno: `pg.query('SELECT * FROM pedidos WHERE id = $1')` + líneas + reservas.
3. Llama `comparePedidoParity(firestoreDoc, pgRows)` → `{ok, diff: [...]}`.
4. Si `ok === false`: entry en `operations_log` type=`dual_write_parity_failed` con `pedidoId`, `fieldDivergencias[]`, snapshot ambos lados.
5. Resumen total del run en `operations_log` type=`dual_write_parity_check` con contadores.
6. Si divergencias > **0** → alerta email a Mariano (si `scheduledTransitoSafetyNet` pattern §107 se reusa).

**Ventana**: 7+ días consecutivos con `divergencias == 0`. Si aparece una divergencia, se investiga y se re-arranca el contador (cero tolerancia para abrir cutover de lectura).

**Métrica de cierre Fase 2 → 3**: 7 días seguidos cero divergencias + Mariano aprueba verbalmente.

---

### Fase 3 — Flip read (S-10.4, paso 3 ADR-008)

**Trigger**: Mariano aprueba post-Fase 2.

**Qué se activa**: `read_from_pg_pedidos_enabled = true` (toggle Panel Control). `dual_write_pedidos_enabled` **sigue `true`** (writes dobles continúan).

**Qué pasa**:
1. Reads de `/pedidos` desde el cliente (listeners `onSnapshot`) **se mantienen** (fuente de verdad transicional sigue siendo Firestore mientras PG termina de probarse).
2. **Nuevos consumidores** server-side (ej. CF reporting, exports Excel tipo §72) empiezan a leer de PG via API read-only. Scope del cambio acotado a esos consumidores.
3. Si PG falla o el flag queda apagado: fallback instantáneo a Firestore + log warning.

**Ventana de observación**: mínimo **14 días**. ADR-008 §paso 3 recomienda doble ventana porque es el primer cambio de comportamiento visible.

**Métrica de cierre Fase 3 → 4**:
- 14 días sin ningún rollback manual del flag.
- Cero quejas de VDE/admin que apunten a inconsistencia PG vs Firestore.

**Rollback instantáneo**: `read_from_pg_pedidos_enabled = false`. Tiempo total < **1 minuto** (toggle UI + propagación Firestore onSnapshot). CUMPLE ADR-008 §Decisión B punto 4.

---

### Fase 4 — Dual-write off (S-10.5, paso 5 ADR-008)

**Trigger**: 30+ días en Fase 3 sin incidentes.

**Qué se desactiva**: `dual_write_pedidos_enabled = false`. El trigger queda vivo pero skip-silencioso.

**Opcional**: eliminar el trigger `onDocumentWritten` entero + pure helpers quedan referenciados sólo por el audit (que sigue corriendo para backup/sanity).

**Qué sigue**:
- PG es fuente de verdad transaccional.
- Firestore `/pedidos` queda como shadow (puede seguir sync'eando en dirección inversa, pero scope de otro plan).
- Esta Fase es decisión arquitectónica de Mariano — queda documentada como posible pero no obligatoria.

---

## Ventanas de observación — resumen

| Transición | Ventana mínima | Métrica |
|---|---|---|
| Fase 0 → 1 (merge + activar writes) | **7 días** | Bundle propagado a todos los VDE |
| Fase 1 → 2 (activar audit) | **1 día** | Audit corrió una vez OK |
| Fase 2 → 3 (flip read) | **7 días** | 0 divergencias consecutivas |
| Fase 3 → 4 (apagar writes dobles) | **14 días post Fase 3** | 0 rollbacks del flag |

Total mínimo si todo sale OK: **29 días**. Realista con buffer: **6-8 semanas** (ADR-008 estimó 2-4 + buffer).

---

## Qué dispara rollback

### Rollback por métrica (automático — alerta + proponer flag OFF)

- `dual_write_write_failed` > **1% de writes** en cualquier ventana de 1h.
- `dual_write_parity_failed` > **0 divergencias** en el audit nocturno (cualquier run).
- Latencia del trigger `onDocumentWritten` p99 > **2 segundos** (Cloud Monitoring alert).
- PG connection pool exhausted > **3 veces/día**.

### Rollback por reporte (manual — Mariano toggle)

- Cualquier VDE reporta un pedido "que no existe" en una vista que ya migró a PG.
- Divergencia aritmética en reportes que usan PG vs reportes que usan Firestore > $1M ARS.
- Cualquier confirmación de pedido falla por error aguas abajo relacionado con PG (ej. constraint `stock_reservations` viola invariante pero el pedido Firestore sí persistió).

### Rollback de catástrofe (Fase 3+ sólo)

- `read_from_pg_pedidos_enabled = false` en Panel Control.
- Propagación: < 1 minuto a todos los clientes vía `onSnapshot` sobre `app_config/feature_flags`.
- Los reads server-side del próximo tick leen de Firestore.
- Los writes dobles **siguen corriendo** (PG data no se borra; queda para auditoría post-mortem).

---

## Archivos a tocar en PRs futuros (NO tocar en este PR)

Este PR deja la **infraestructura base** detrás de flags. Los siguientes archivos NO se modifican ahora pero quedarán tocados en PRs siguientes (S-10.3.1 → S-10.5):

### S-10.3.1 — Activar writes dobles

- `functions/index.js`: export del trigger `onPedidoWriteToPg` (hoy stub sin export).
- `scripts/audit/W_dual_write_health.cjs`: pasar a modo apply (`--apply` en vez de read-only).
- `app_config/feature_flags.dual_write_pedidos_enabled.value` → `true` via toggle Panel Control.

### S-10.3.2 — Activar audit nocturno

- `functions/index.js`: export del scheduled `nightlyParityCheck`.

### S-10.4 — Flip read

- Nuevo CF `getPedidosFromPgCF` (callable read-only de PG).
- Consumidores server-side migran según prioridad (exports Excel, reports BQ sync, etc.).
- `src/domains/*.js`: nuevos consumidores client-side quedan OPT-IN via el flag.
- `app_config/feature_flags.read_from_pg_pedidos_enabled.value` → `true` via toggle.

### S-10.5 — Apagar writes dobles

- `functions/index.js`: delete del trigger `onPedidoWriteToPg` (o dejar con skip hardcoded y timeout de 90d).
- `src/pure/dual-write/`: keep para audit retroactivo.
- `app_config/feature_flags.dual_write_pedidos_enabled.value` → `false`.

### Archivos INTACTOS en todas las fases (pre-S-10.5)

- `functions/core/commit-pedido-core.js` — hoy escribe Firestore; **no se toca**. El trigger `onPedidoWriteToPg` reacciona al write exitoso.
- `functions/core/release-asig-core.js`, `reparto-core.js`, `auto-send-sap-core.js` — intactos.
- `index.html`, `src/domains/*.js`, `firestore.rules`, `firestore.indexes.json` — intactos.
- `backend-new/db/schema/0001_initial.sql` — intacto (lo gestiona el PR de P1.3).

---

## Alternativas descartadas (superpowers:brainstorming)

### A) Change Data Capture (CDC) vía Firestore triggers → Pub/Sub → Dataflow → PG

**Pros**: pattern "idiomático" GCP para data pipelines. Resilient a fallos (reintentos Pub/Sub).

**Contras**:
1. **4 piezas nuevas de infra** (trigger CF + Pub/Sub topic + Dataflow job + PG writer). Operabilidad chica (Mariano single-maintainer).
2. Dataflow cuesta USD 150+/mes mínimo.
3. Latencia aumenta (Firestore → CF → Pub/Sub → Dataflow → PG puede ser 5-30s p95 vs <2s con trigger directo).
4. Orden de writes no garantizado — requiere lógica de dedup con `pedido.updatedAt` en PG.

**Rechazada**. Para 2k writes/día con 15 vendedores es sobredimensionado. Volvemos a evaluar si Shimano crece 10x en volumen (ADR-008 §Qué invalidaría la recomendación).

### B) Event Sourcing (append-only event log en PG, state reconstruida on-read)

**Pros**: historial inmutable, re-play determinístico.

**Contras**:
1. Requiere **reescribir** `commitPedidoCore` entero para que emita eventos en vez de mutar state.
2. Reads se vuelven más caros (proyecciones materializadas).
3. Scope creep gigante — no es lo que ADR-001 pidió.

**Rechazada**. ADR-001 modeló state actual (tablas relacionales); event sourcing es modelo distinto. Puede ser v2 en 1-2 años si la complejidad de audit lo justifica.

### C) Write-ahead log en Firestore (`pedidos_pending_sync/*`) + batch job polling

**Pros**: no requiere trigger Cloud Function (más barato).

**Contras**:
1. Latencia de minutos (batch cada 5min) en vez de segundos (trigger).
2. Inventa un nuevo pattern en lugar de usar triggers Firestore nativos.
3. Doble write cliente-side es mejor desde esa perspectiva — pero no queremos pagar costo cliente.

**Rechazada**. Trigger `onDocumentWritten` es el pattern canónico de Firebase y ya lo usamos (§107 `onDep11IncreaseCreateReparto`).

### D) Doble escritura desde el cliente (JS directo a PG vía REST)

**Pros**: elimina latencia trigger.

**Contras**:
1. Credenciales PG expuestas en bundle (malo). Aunque se routee via callable, mejor que el server sea el único que toca PG.
2. Requiere sync **sincrónico** en el commit — si PG falla, ¿rebota el pedido? ¿Lo acepta igual? Fail-open vs fail-closed en dos sistemas.
3. Complicación ADR-008 §paso 4 (fail-open en lecturas) porque habría fail-open en writes también.

**Rechazada**. Writes dobles siempre server-side.

---

## Decisiones específicas tomadas (brainstorming resuelto)

1. **Trigger `onDocumentWritten` (no `onDocumentCreated`)**: cubre creates + updates + deletes en un solo CF. Deletes se mapean a `UPDATE pedidos SET closed_at = NOW()` en PG (soft-delete, ADR-001 §pedidos).

2. **Advisory lock por pedidoId**: el trigger adquiere `pg_advisory_xact_lock(hashtext(pedidoId))` para serializar con otras invocaciones del mismo pedido (ej. updates concurrentes). Previene write amplification en el trigger del snapshot.

3. **Transform es PURO, I/O separado**: `transformPedidoToPg(firestoreDoc) → {pedido, lines, reservations}`. No lee ni escribe nada. El wrapper en `functions/dual-write/on-pedido-write-to-pg.js` hace el I/O.

4. **Compare es PURO, devuelve diff estructurado**: `comparePedidoParity(fsDoc, pgRows) → {ok, diff: [{path, fsValue, pgValue, severity}]}`. Reusable en audit nocturno + en scripts manuales de debug.

5. **Audit genera `operations_log` entries + markdown en fase ad-hoc**: el scheduled CF escribe a `operations_log/{auto-id}` y el script W imprime tabla ASCII. Mariano puede leerlos en Firestore o correr el script a mano.

6. **Tests cubren las 6 formas canónicas de línea (§40)**: BO + ASIG + confirmed + invoiced + cancelled + enTransito. Property-based tests cubren casos borde (§54).

7. **Shape de líneas en PG preserva `splitFromLineIndex` + audit de reversiones** (§40.5, §40.7, §40.11).

8. **Sin cambio al Firestore rules**: colecciones PG no existen en Firestore. Rules intactas. Panel Control toggle de flag ya está gateado por `isMariano()` (ADR-009).

---

## Verification (verification-before-completion)

Antes de declarar este PR done, verificar:

- [ ] `npm run test:unit` → tests dual-write pasan.
- [ ] `npm run test:functions` → trigger stubs pasan con mock PG + flag OFF/ON.
- [ ] Sync test §57 pasa (pure vs mirror byte-equivalent).
- [ ] `biome check src/pure/dual-write functions/core/dual-write functions/dual-write` → clean.
- [ ] Grep final: `grep -rn "dual_write_pedidos_enabled" functions/index.js` → **cero matches** (el trigger NO se exporta).
- [ ] Flag en `app_config/feature_flags` documentado pero NO seteado (lo setea Mariano via Panel Control cuando active Fase 1).
- [ ] Rules Firestore **sin cambios** (verificado con `git diff firestore.rules` → empty).
- [ ] Schema PG **sin cambios** (verificado con `git diff backend-new/db/schema/` → empty).
- [ ] Playwright E2E vs dev: confirmar pedido test → Firestore recibe el write, PG no ve nada (porque flag OFF).

---

## Rollback plan post-merge

Si post-merge aparece un bug latente (bundle pesa más, SW timeout, etc.):

1. `git revert <sha_merge>` + PR revert + `gh pr merge --squash`.
2. No hay data en PG que limpiar (flag OFF garantiza 0 writes).
3. No hay triggers activos en Firebase que desactivar.
4. CLAUDE.md agrega sección §110 (nuevo id) con el precedente.

---

## Pendiente de Mariano

1. Firmar ADR-008 (cambiar Status de Proposed a Accepted).
2. Aprobar este plan.
3. Decidir provider PG (Cloud SQL vs Supabase vs AlloyDB) — bloqueador de Fase 1 pero no de Fase 0.
4. Aprobar ventana para activar Fase 1 (idealmente lunes-martes para tener ventana de observación completa antes del fin de semana).
