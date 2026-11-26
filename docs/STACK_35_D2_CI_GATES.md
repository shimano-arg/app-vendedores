# STACK S-8 D2 — CI gates para E2E + Rules

**Branch**: `chore/d2-ci-gates-e2e-rules`
**Workflow tocado**: `.github/workflows/test-and-lint.yml`
**Fecha**: 2026-11-25

---

## Objetivo

Que las dos suites de confianza E2E (flujos críticos cross-rol) y Rules (Firestore security) sean **checks required** del PR workflow — un PR con E2E o Rules rotos no se mergea.

## Estado antes de D2

- **Rules** (`tests/rules/*`): ya corrían dentro del job `security-tests` con emulador Firestore + `REQUIRE_EMULATOR=1` + gate `check-known-failures.mjs rules`. Required de facto (el job falla si el gate falla).
- **E2E** (`tests/e2e/*.emulator.test.js`): el script `npm run test:e2e` existe (P2-A.a 2026-11-25 PR #1449, 6 archivos) y wrapea `firebase emulators:exec --only functions,firestore,auth`. **No corría en CI** — solo manual.
- **Functions** (`tests/functions/*`): ya corrían en `security-tests` + `functions-with-emulator`.

## Cambios D2

### 1. Nuevo job `e2e-tests` (required)

Agregado al final de `test-and-lint.yml`. Setup idéntico al job `security-tests` (Node 22 + Java 21 + firebase-tools@14.27.0 pinneado), pero con `--only firestore,auth` (los 6 E2E no tocan Functions emulator; usan `@firebase/rules-unit-testing` + mocks). Duración estimada: ~4-6 min.

**Pasos**:
1. Checkout + Setup Node 22 + Setup Java 21.
2. `npm ci` root + `cd functions && npm ci`.
3. **E2E tests**: `npx --yes firebase-tools@14.27.0 emulators:exec --project demo-ci --only firestore,auth "npx vitest run tests/e2e/01-...06-...emulator.test.js --reporter=json --outputFile=e2e-report.json"`.
4. **Gate E2E**: node inline script valida:
   - `e2e-report.json` existe (vitest no crasheó).
   - `numTotalTests >= 6` (piso mínimo — 1 test por archivo).
   - `numFailedTests === 0`.
   - Los 6 archivos esperados están en `testResults[]`.

**Required**: sin `continue-on-error`. Cualquier falla del gate falla el workflow → PR bloqueado en branch protection.

### 2. Rules — sin cambios, ya era required

El step `Rules tests (emulador Firestore)` + `Gate rules (fallas conocidas vs nuevas)` del job `security-tests` ya cumple la definición de "required check":
- Corre con `REQUIRE_EMULATOR=1`.
- `check-known-failures.mjs rules rules-report.json` falla con exit 1 ante:
  - Falla nueva (no listada en `tests/known-failures.json`).
  - Falla conocida que ahora pasa (toca removerla).
  - Firma de error distinta a la documentada (regresión encubierta).
  - Piso `minExecuted` no alcanzado.

No se duplicó. Documentado acá como referencia.

### 3. Skip-wrap §40.8 — fallback si emulator no disponible

Los tests E2E usan el patrón §40.8 (ver `tests/e2e/lib/setup-emulator.js`):

```js
export let emulatorUnavailable = false;
// si initializeTestEnvironment() falla por conexión → emulatorUnavailable=true
// it.skipIf(emulatorUnavailable) en cada escenario
```

**En CI**: `REQUIRE_EMULATOR=1` + el gate exige `numTotalTests >= 6`. Si el emulator Firebase no levanta (java missing, puerto ocupado, versión de firebase-tools incompatible), **el gate falla** porque:
- O bien `firebase emulators:exec` sale non-zero (el step entero falla antes del gate).
- O bien los tests se skippean y el gate pilla `numTotalTests < 6`.

**En dev local**: si Mariano corre `npm run test:e2e` sin `REQUIRE_EMULATOR=1` y no tiene Java instalado, los tests skippean con un warning amigable. En CI no — fallan duro.

## Verificación esperada post-merge

```bash
# En el PR, GitHub Actions debería mostrar 3 jobs:
# - test (unit + typecheck + lint + smoke + python + bundle budget)
# - security-tests (rules + functions)
# - functions-with-emulator (D8 Capa 2)
# - e2e-tests (NUEVO — 6 E2E scenarios)
```

El tiempo total del workflow sube ~4-6 min por el emulator warmup del job nuevo, pero corre en paralelo con los otros 3 → no bloquea el critical path.

## Rollback

Un solo edit: remover el bloque `e2e-tests:` al final del archivo YAML. El resto del workflow queda idéntico. Nada que revertir en `package.json` (los scripts `test:e2e` + `test:rules` ya existían).

## Branch protection (acción manual pendiente)

Después del merge, agregar al branch protection de `main` los nuevos checks required:

- `test` ✅ (ya existe)
- `security-tests` ✅ (ya existe)
- `functions-with-emulator` ✅ (ya existe)
- `e2e-tests` ⬅️ NUEVO (agregar via GitHub Settings → Branches → main → Require status checks).

Alternativamente, via gh CLI:
```bash
gh api -X PATCH /repos/<owner>/<repo>/branches/main/protection \
  -f required_status_checks.contexts[]=e2e-tests
```

## Precedente

- PR #1449 (P2-A.a, 2026-11-25): 10 escenarios E2E creados pero sin wiring CI.
- PR #1437 (INFRA, 2026-10-29): rules + functions se gatearon via `check-known-failures.mjs`. Precedente directo del pattern usado acá.
- CLAUDE.md §77 + §78 + §90: gates nuevos requieren tests que fallan abierto cuando la fuente está vacía. El gate E2E cumple: si `e2e-report.json` no existe, falla con mensaje explícito.
