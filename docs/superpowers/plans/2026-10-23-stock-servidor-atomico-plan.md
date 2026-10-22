# Stock servidor atómico — Plan de ejecución

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** cerrar los 11 grises grandes de la auditoría 2026-10-22 (G1.G01, G1.G02, G1.G04, G1.G09, G1.G13, G1.G14, G1.G16, G2.03, G2.05, G3.05, G4.03) moviendo la decisión de stock del cliente al servidor en una transacción atómica.

**Architecture:** CF callable `commitPedidoCF` con `runTransaction` que relee stock dentro, calcula breakdown server-side con copia espejo de `getStockBreakdown`, decide por línea cuánto va a confirmed vs BO, escribe atómicamente, cancela ASIG consumidas. Agregado por SKU (`stock_snapshot/{SKU}`) para evitar hot-spot. serverTimestamp para TTLs. Bloqueo UI edición post-SAP. Fix UNION en `mergeLinesFromOrders` para G2.03.

**Tech Stack:** vitest, fast-check, Firebase emulators (functions + firestore), firebase-admin, Cloud Functions Gen 2, Firestore, @firebase/rules-unit-testing.

**Branch:** `feat-stock-servidor-atomico` desde `main` (v1425, SHA `8397b0d`).

**Design doc base**: `docs/superpowers/specs/2026-10-23-stock-servidor-atomico.md`.
**Inventario**: `docs/auditoria/50_INVENTARIO_CALLSITES_STOCK.md`.

**Scope**: SESIÓN 1 (E1-E4, budget 73t). Sesión 2 (E5-E13, 110t) después de 3 días hábiles observación.

---

## SESIÓN 1 — Corazón funcional (budget 73t)

### E1 — Mirror + stock_snapshot/{SKU} + agregado por SKU

**Files:**
- Modify: `functions/core/pedido-snapshot-core.js` (completa buckets faltantes: utilizablePara, FIFO desagregado)
- Create: `functions/core/stock-snapshot-per-sku-core.js` (nuevo shape per-SKU + migrate helpers)
- Modify: `functions/index.js` (trigger `onPedidoWriteRecalcSnapshot` escribe en ambos docs — shadow 24h)
- Create: `tests/unit/audit/stock-breakdown-sync-strict.test.js` (test comparación tokens R1-R10 cliente vs servidor)
- Modify: `firestore.indexes.json` (índice para `stock_snapshot/{SKU}` si corresponde)
- Create: `scripts/migrate/_migrate_stock_snapshot_to_per_sku.cjs` (dry-run migración incremental)

**Acciones:**

- [ ] Mirror getStockBreakdown completo: agregar waitlistCpst bucket, pendienteReparto desde `ingresos_reparto`, `utilizablePara(cardCode)` helper, `asignadas.detalle` FIFO.
- [ ] Test RED `tests/unit/audit/stock-breakdown-sync-strict.test.js` que compare tokens de todas las ramas R1-R10 entre `src/pure/stock-breakdown.js` y `functions/core/pedido-snapshot-core.js`.
- [ ] Diseño doc `stock_snapshot/{SKU}` con shape nuevo (`_version: 'app_v8'`).
- [ ] `onPedidoWriteRecalcSnapshot` escribe en AMBOS: `app_config/stock_snapshot` (legacy) + `stock_snapshot/{SKU}` (nuevo).
- [ ] Script dry-run migración incremental: para cada SKU en stock_snapshot legacy, crear doc per-SKU.
- [ ] Correr dry-run.
- [ ] LF normalize + biome write.

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/stock-breakdown-sync-strict.test.js --reporter=default 2>&1 | tee /tmp/e1.txt
grep -E "Test Files.*passed \(1\)" /tmp/e1.txt
grep -q "waitlistCpst\|utilizablePara\|asignadas.detalle" functions/core/pedido-snapshot-core.js
grep -q "stock_snapshot/{SKU}\|collection\\\\(.stock_snapshot" functions/index.js
echo GATE_E1_OK
```

**Budget:** 15 turnos.

**Riesgo falso verde:**
- Test sync strict pasa pero servidor no tiene todas las ramas → mitigación: test tiene fixture completo cross-ramas.
- Trigger escribe en ambos docs pero el per-SKU queda incompleto en algún SKU → mitigación: script dry-run reconcile corre al final de E1 y reporta divergencias.

---

### E2 — CF `commitPedidoCF` + emulator setup + tests concurrencia

**Files:**
- Create: `functions/core/commit-pedido-core.js` (lógica deps-injected)
- Modify: `functions/index.js` (export CF callable `commitPedidoCF`)
- Create: `tests/functions/commit-pedido-core.test.js` (unit con mocks)
- Create: `tests/functions/commit-pedido-concurrency.test.js` (emulator-backed, 2 txn paralelas)
- Create: `tests/setup/emulator.js` (helper que levanta emulator functions:5001 + firestore:8080)
- Modify: `package.json` (script `test:emulator` que corre con emulator)
- Modify: `firebase.json` (emulator config)

**Acciones:**

- [ ] Setup emulator Firebase local: `firebase init emulators` solo functions+firestore (si no está).
- [ ] `tests/setup/emulator.js` levanta emuladores pre-tests + cleanup.
- [ ] Diseñar `commitPedidoCore(deps, payload)` con shape del contrato:
  ```js
  async function commitPedidoCore(deps, payload) {
    // Idempotencia por draftId
    // Validación clientVersion vs min_app_version
    // runTransaction: lee stock_snapshot/{sku} per SKU + ingresos_reparto
    // Compute breakdown + decide por línea
    // Write pedido + update per-SKU + cancel ASIG consumidas
    // Return { pedidoId, lines, diffVsClient }
  }
  ```
- [ ] Test RED `tests/functions/commit-pedido-core.test.js` con mocks: 10 tests cubriendo happy paths + edge cases + todos los códigos de error.
- [ ] Test RED `tests/functions/commit-pedido-concurrency.test.js` con emulator:
  1. 2 VDEs confirman mismo SKU libre=1 → uno gana + otro BO (G1.G01).
  2. 1 VDE confirma mientras `applyRepartoManualCF` corre → secuenciado (G1.G02).
  3. Idempotencia: mismo draftId 2× → mismo pedidoId.
  4. snapshot >45min → SNAPSHOT_TOO_OLD.
  5. clientVersion < min_app_version → VERSION_OLD.
  6. cliente con waitlist abierto → CLIENT_HAS_OPEN_WAITLIST.
  7. STOCK_CHANGED con `autoAcceptStockChange=false`.
  8. STOCK_CHANGED con `autoAcceptStockChange=true` → auto-accept.
- [ ] Implementar commitPedidoCore + export CF.
- [ ] Rebuild bundle (no afecta functions pero sí package de deploy).
- [ ] LF normalize + biome write.

**Gate ejecutable:**
```bash
# Setup emulator si no está
firebase emulators:exec --only functions,firestore \
  "npx vitest run tests/functions/commit-pedido-core.test.js tests/functions/commit-pedido-concurrency.test.js --reporter=default" | \
  tee /tmp/e2.txt
grep -E "Test Files.*passed" /tmp/e2.txt
! grep -E "Tests.*[1-9][0-9]* failed" /tmp/e2.txt
grep -q "export async function commitPedidoCore" functions/core/commit-pedido-core.js
grep -q "export const commitPedidoCF" functions/index.js
echo GATE_E2_OK
```

**Budget:** 30 turnos.

**Riesgo falso verde:**
- Tests pasan pero las 2 txn se ejecutan secuencialmente (sin race real) → mitigación: usar `Promise.all([txn1, txn2])` + hook `onBeforeWrite` en el core que inserta `await new Promise(r => setTimeout(r, 50))` para forzar interleave.
- Mock bypasea `runTransaction` → test unit no detecta. Mitigación: emulator real + validación en logs.
- Emulator en Windows no levanta por puerto ocupado. Mitigación: dynamic port + env var override.

---

### E3 — Migrar `doConfirmPedido` cliente a `commitPedidoCF`

**Files:**
- Modify: `index.html` (`doConfirmPedido`, `persistPendingEntry`, `addManualBackorder`)
- Modify: `src/domains/sap-client.js` (nuevo helper `callCommitPedidoCF`)
- Create: `tests/unit/audit/do-confirm-pedido-usa-cf.test.js`
- Modify: `app.bundle.js` + `chunks/*.js` (rebuild)

**Acciones:**

- [ ] Grep de `pedidos.add(docData)` en `index.html`.
- [ ] Reemplazar los 2 call-sites de categoría A (18786 addManualBackorder, 36031 persistPendingEntry) por `callCommitPedidoCF`.
- [ ] Agregar modal "diffVsClient" para mostrar al VDE cuando stock cambió.
- [ ] Checkbox persistido localStorage: "aceptar automáticamente cambios de stock al confirmar" (default: false).
- [ ] Test RED `tests/unit/audit/do-confirm-pedido-usa-cf.test.js`: mock del CF + verifica que:
  1. doConfirmPedido llama a commitPedidoCF con payload correcto.
  2. Si diffVsClient null → UI muestra snackbar verde.
  3. Si diffVsClient con delta y autoAcceptStockChange=false → modal naranja con detalle.
  4. Si diffVsClient con delta y autoAcceptStockChange=true → snackbar informativo.
  5. Errores de todos los códigos → UI apropiada.
- [ ] Rebuild bundle.
- [ ] LF normalize + biome write.

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/do-confirm-pedido-usa-cf.test.js --reporter=default 2>&1 | tail -5
grep -c "fbDb.collection('pedidos').add(docData)" index.html | awk '{ if ($1 == 0) print "✓ 0 pedidos.add"; else print "✗ "$1" quedaron"; exit ($1 == 0 ? 0 : 1) }'
grep -q "commitPedidoCF\|callCommitPedidoCF" index.html
echo GATE_E3_OK
```

**Budget:** 15 turnos.

**Riesgo falso verde:**
- Alguna sub-ruta (ej. flow partner VDE, flow manual-backorder sin cliente) sigue escribiendo directo → grep del gate detecta 0 ocurrencias.
- La migración rompe algún caso borde del flow actual → mitigación: suite existente completa (2201 PASS) debe seguir pasando.

---

### E4 — Migrar `_cpstConfirmar` cliente a `commitPedidoCF` (variant stock-asignado)

**Files:**
- Modify: `index.html` (`_cpstConfirmar`)
- Modify: `src/domains/sap-client.js` (variante `callCommitPedidoCFCpst`)
- Create: `tests/unit/audit/cpst-usa-cf.test.js`
- Modify: `app.bundle.js` + `chunks/*.js` (rebuild)

**Acciones:**

- [ ] Reemplazar `_cpstConfirmar` por llamada a `commitPedidoCF` con `origen='cpst'` + `lines[].origenLinea='stock-asignado'` + `asigRefs` por línea.
- [ ] Verificar que el bloque v1280 (cancelación ASIG) se ejecute **server-side** dentro de la txn de la CF, NO client-side.
- [ ] Test RED `tests/unit/audit/cpst-usa-cf.test.js` con fixtures:
  1. CPST normal: 1 cliente, 1 waitlist, 3 SKUs ASIG → pedido confirmed + ASIG canceladas en misma txn.
  2. Regresión H1: línea con `origen='stock-asignado'` sin `asigRefs` → CF detecta data corrupta + loguea alerta + fallback a cálculo global.
  3. Chained merge preserve asigRefs (G2.03 — ya debería funcionar en server con el fix de E9, por ahora en E4 solo validamos input shape).
- [ ] Rebuild bundle.
- [ ] LF normalize + biome write.

**Gate ejecutable:**
```bash
npx vitest run tests/unit/audit/cpst-usa-cf.test.js --reporter=default 2>&1 | tail -5
grep -c "revision_waitlist.*\.add(" index.html | awk '{ if ($1 <= 3) print "✓ <=3 ocurrencias (resto no-CPST)"; else print "✗ "$1" ocurrencias"; exit ($1 <= 3 ? 0 : 1) }'
grep -q "commitPedidoCFCpst\|origen.*cpst" index.html
echo GATE_E4_OK
```

**Budget:** 13 turnos.

**Riesgo falso verde:**
- `pedidosOrigenes` + `asigRefs` no se persisten correctamente desde servidor → fixture de regresión H1 + chained merge.
- Flow partner VDE (Pachi) tiene variante distinta → test específico.

---

### Checkpoint sesión 1 — Deploy + observación 3 días hábiles

**Files:**
- Modify: `README.md §41` (bullet v1430 shipped)
- Create: `Desktop/INFORME_COWORK_sesion_1_shipped.md`

**Acciones:**

- [ ] Suite completa `npm run test` → 2200+ PASS, 0 FAIL.
- [ ] `npx biome check --write src/ functions/` → clean.
- [ ] `npx tsc --noEmit` → clean.
- [ ] `node build.js` → bundle OK.
- [ ] Bump APP_VERSION v1425 → v1430 (reserved para sesión 1 shipped).
- [ ] Bump CACHE_VERSION.
- [ ] Push + PR → main + merge --squash --admin.
- [ ] `firebase deploy --only functions:commitPedidoCF,functions:onPedidoWriteRecalcSnapshot,functions:refreshStockSnapshotCF`.
- [ ] `firebase deploy --only firestore:indexes`.
- [ ] GH Pages deploy auto.
- [ ] Smoke prod 10min: `gcloud logging` → cero errores en commitPedidoCF.
- [ ] Informe cowork autocontenido en Desktop.

**Pausa humana obligatoria**: observación 3 días hábiles. Criterios para arrancar sesión 2:
- Cero rechazos inesperados (grep logs `permission-denied` en commitPedidoCF).
- Cero duplicados (grep audit `_duplicateDraftId`).
- Cero `CONTENTION_RETRY_EXHAUSTED` en logs.
- Mariano/VDEs no reportaron bugs.

---

## SESIÓN 2 — Endurecer resto + rollout (budget 110t)

Prerrequisito: 3 días hábiles de observación sesión 1 OK.

### E5 — Endurecer `applyRepartoManualCF` + `onDep11IncreaseCreateReparto`

**Files:**
- Modify: `functions/core/reparto-core.js`
- Create: `tests/functions/reparto-concurrency.test.js` (emulator)

**Budget:** 10 turnos.

**Gate:**
```bash
firebase emulators:exec --only functions,firestore \
  "npx vitest run tests/functions/reparto-concurrency.test.js" | \
  grep -q "Test Files.*passed"
echo GATE_E5_OK
```

---

### E6 — Migrar `autoConfirmPendingPedidosCF` a `commitPedidoCore`

**Files:**
- Modify: `functions/core/auto-confirm-pending-core.js`
- Modify: `tests/functions/auto-confirm-pending.test.js`

**Budget:** 10 turnos.

---

### E7 — serverTimestamp en TTLs cliente

**Files:**
- Modify: `index.html` (grep + replace `new Date().toISOString()` que escribe TTL)
- Modify: `src/pure/pedido-split.js` (si tiene algún timestamp)

**Budget:** 10 turnos.

**Gate:**
```bash
grep -cE "new Date\\(\\)\\.toISOString\\(\\).*confirmedAt\|asigAt" index.html | awk '{ if ($1 == 0) print "✓ 0"; else print "✗ "$1 }'
echo GATE_E7_OK
```

---

### E8 — Bloqueo UI edición post-SAP + banner (D4 = A)

**Files:**
- Modify: `index.html` (modal pedido detalle + edit)
- Create: `tests/unit/audit/edit-post-sap-blocked.test.js`

**Budget:** 15 turnos.

---

### E9 — Fix G2.03 unificación asigRefs (chained merge)

**Files:**
- Modify: `src/pure/unificar-ordenes.js` (`mergeLinesFromOrders` + nuevo helper `unionAsigRefsDedup`)
- Create: `tests/unit/audit/merge-chained-asigrefs.test.js`

**Budget:** 10 turnos.

**Gate:**
```bash
npx vitest run tests/unit/audit/merge-chained-asigrefs.test.js --reporter=default
grep -q "unionAsigRefsDedup" src/pure/unificar-ordenes.js
echo GATE_E9_OK
```

---

### E10 — firestore.rules cutover + min_app_version + CF `updatePedidoLinesCF`

**Files:**
- Modify: `firestore.rules` (remueve `'lines'` whitelist VDE)
- Create: `functions/core/update-pedido-lines-core.js`
- Modify: `functions/index.js` (export `updatePedidoLinesCF`)
- Create: `tests/rules/pedidos-lines-deny.test.js` (@firebase/rules-unit-testing)
- Modify: `index.html` (lee `app_config/version_minima` en load + modal bloqueo si cliente < min)
- Create: Firestore doc `app_config/version_minima` con valor placeholder (admin manual)

**Acciones:**

- [ ] CF `logDirectWriteAttempt`: trigger on pedidos write + loguea en Cloud Logging si no es Admin SDK. **Shadow 24h**.
- [ ] Pausa humana: Mariano revisa logs 24h. Si cero alertas → cutover.
- [ ] Rules deniegan `'lines'` whitelist VDE.
- [ ] CF `updatePedidoLinesCF` para edits legítimos (precio, qty, notas pre-envío).
- [ ] Cliente lee `app_config/version_minima` en load. Si `APP_VERSION < min` → modal bloqueo + reload.
- [ ] Tests rules con emulator.

**Budget:** 15 turnos.

**Pausa humana obligatoria antes del cutover**: Mariano aprueba después de ver cuántos VDEs tienen bundle viejo + los 24h de logs shadow.

---

### E11 — Property-based tests concurrencia

**Files:**
- Create: `tests/unit/property/stock-concurrent-invariants.test.js` (fast-check + emulator)

**Budget:** 15 turnos.

---

### E12 — Prueba race contra emulador (D3 = A, NO prod)

**Files:**
- Create: `tests/integration/race-condition-same-sku.test.js`

**Acciones:**

- [ ] Setup emulator con cliente ficticio + SKU test + stock=1.
- [ ] 2 CFs commitPedidoCF concurrentes `Promise.all` sobre mismo SKU.
- [ ] Validar que exactamente 1 gana con qtyConfirmed=1 + otro queda con qtyBO=1 + mensaje "STOCK_CHANGED".
- [ ] Lo mismo con 1 reparto + 1 confirm simultáneos.

**Budget:** 10 turnos.

---

### E13 — PR + merge + deploy + verify + informe

**Files:**
- Modify: `README.md`
- Modify: `CLAUDE.md §56-§58` (reglas durables nuevas: §56 commitPedidoCF obligatorio, §57 serverTimestamp TTLs, §58 unionAsigRefsDedup)
- Create: `Desktop/INFORME_COWORK_sesion_2_shipped.md`

**Budget:** 15 turnos.

---

## Resumen budgets

| Sesión | Etapa | Budget | Pausa |
|---|---|---:|---|
| 1 | E0 design doc | 20 | SÍ (ejecutado, pedimos OK ahora) |
| 1 | E1 mirror + per-SKU | 15 | - |
| 1 | E2 CF corazón + concurrency tests | 30 | - |
| 1 | E3 doConfirmPedido migrate | 15 | - |
| 1 | E4 _cpstConfirmar migrate | 13 | - |
| 1 | **Checkpoint deploy** | - | **SÍ** (observación 3 días hábiles) |
| 2 | E5 reparto endurecer | 10 | - |
| 2 | E6 auto-confirm migrate | 10 | - |
| 2 | E7 serverTimestamp cliente | 10 | - |
| 2 | E8 edit post-SAP bloqueo | 15 | - |
| 2 | E9 G2.03 fix | 10 | - |
| 2 | E10 rules cutover | 15 | SÍ (ver VDEs con versión vieja) |
| 2 | E11 property concurrency | 15 | - |
| 2 | E12 race emulador | 10 | - |
| 2 | E13 deploy + informe | 15 | - |
| **Total** | | **203** | 3 pausas obligatorias |

---

## Entregables sesión 1

- Rama `feat-stock-servidor-atomico` con 5 commits (E0-E4) + checkpoint.
- PR mergeado → `main` v1430.
- `docs/superpowers/specs/2026-10-23-stock-servidor-atomico.md`.
- `docs/superpowers/plans/2026-10-23-stock-servidor-atomico-plan.md`.
- `docs/auditoria/50_INVENTARIO_CALLSITES_STOCK.md`.
- CFs nuevas: `commitPedidoCF`, `refreshStockSnapshotCF`, trigger `onPedidoWriteRecalcSnapshot` extendido.
- `stock_snapshot/{SKU}` colección nueva (shadow 24h).
- Tests: suite 2200+ PASS + tests concurrencia emulator.
- `Desktop/INFORME_COWORK_sesion_1_shipped.md`.

## Entregables sesión 2

- 11 de 11 grises grandes CERRADOS.
- Tabla final con test que cubre cada uno.
- CLAUDE.md §56-§58 durable rules.
- `Desktop/INFORME_COWORK_sesion_2_shipped.md`.
- Prod en v1440 (o similar).
