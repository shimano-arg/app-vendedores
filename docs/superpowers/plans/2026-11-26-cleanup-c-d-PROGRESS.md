# 2026-11-26 Cleanup criterios c + d — PROGRESS

Branch: `chore/s10-cleanup-c-d` (base `origin/main` b9023ada)

## PASO 1: branch creado + progress file armado. archivos tocados: docs/superpowers/plans/2026-11-26-cleanup-c-d-PROGRESS.md (nuevo). next step: inventario criterio (c) TODOs sin owner.

## PASO 2: inventario (c) TODOs sin owner. comando: `grep -rnE "//[[:space:]]*TODO\b" src/ functions/ scripts/ index.html --include='*.js' --include='*.cjs' --include='*.html' | grep -vE "TODO[[:space:]]+(Mariano|Pablo|Santi|Ioannis|Federico|Pachi|Martin|Mauricio|Gonzalo)"`. Resultado: **1 match total**, pero vive en `functions/core/pedido-snapshot-core.js:689` — zona PROHIBIDA por §57 (mirror). Criterio (c) queda en **0 candidatos accionables**. No se crea `docs/TODOS_SIN_OWNER_2026-11-26.md`. archivos tocados: ninguno. next step: inventario criterio (d).

## PASO 3: inventario (d) .md huérfanos. 53 .md candidatos (excluyendo docs/auditoria/ y docs/adr/). Filtro fecha < 2026-09-27: 6 con fecha explícita vieja. Verifico referencias por basename:
- `2026-09-18-mercadolibre-crm-section-plan.md` → referenciado por README.md. DEJAR.
- `2026-09-22-planner-plan.md` → referenciado por README.md. DEJAR.
- `2026-09-18-mercadolibre-crm-section-design.md` → referenciado por README.md + `src/domains/meli.js`. DEJAR.
- `2026-09-22-planner-design.md` → referenciado por README.md. DEJAR.
- `2026-08-07-mobile-bottom-nav-plan.md` → **0 referencias por basename exacto** (README menciona `#mobile-bottom-nav` id CSS, NO el nombre del .md). CANDIDATO ARCHIVAR.
- `2026-08-07-mobile-bottom-nav-design.md` → **0 referencias por basename exacto**. CANDIDATO ARCHIVAR.

Criterio (d): **2 candidatos** a archivar en `docs/archive/2026/`. archivos tocados: ninguno todavía. next step: ejecutar archivado.

## PASO 4: archivado ejecutado. `mkdir -p docs/archive/2026` + 2x `git mv`. archivos tocados:
- `docs/plans/2026-08-07-mobile-bottom-nav-plan.md` → `docs/archive/2026/2026-08-07-mobile-bottom-nav-plan.md`
- `docs/specs/2026-08-07-mobile-bottom-nav-design.md` → `docs/archive/2026/2026-08-07-mobile-bottom-nav-design.md`

`git status --short` confirma 2 `R` (renames detectados por git). next step: gates (biome + tsc + tests).

## PASO 5: gates ejecutados.
- `npx biome check docs/archive/2026/ docs/superpowers/plans/2026-11-26-cleanup-c-d-PROGRESS.md` → .md ignorados por config, clean sobre cambios.
- `npx tsc --noEmit --project tsconfig.json` → sin errores.
- `npm run test:unit` → **258 test files PASS, 3472 tests PASS, 13.51s**.
- Commit: `82b09322 chore(cleanup): archivar 2 docs/*.md huérfanos en docs/archive/2026/ (criterio d)`.

Criterio (c) NO genera commit por 0 candidatos accionables (documentado en PASO 2).

next step: push + PR.




